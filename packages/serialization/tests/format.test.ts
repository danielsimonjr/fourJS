/**
 * The §79 scene document (plan P11-1) — canonical validation, encoding, and
 * every refusal.
 *
 * Four things are pinned here:
 *
 * 1. **Validation is a rebuild, not an inspection.** Unknown fields are dropped,
 *    defaults are dropped, key order is fixed — so one scene has exactly one
 *    spelling and `encode(decode(text)) === text`.
 * 2. **Every refusal has a test**, by error *code* for the two `FourError`s and
 *    by message path for the `TypeError`s, because a validator whose failure
 *    modes are untested is a validator that fails open.
 * 3. **`__proto__` cannot enter the document**, whether as a document key
 *    (dropped by the rebuild) or inside free-form JSON (refused outright).
 * 4. **Numbers are JSON numbers.** `NaN`, `±Infinity`, and `undefined` are
 *    refused rather than written as `null`; `-0` normalizes to `0`.
 */

import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  SCENE_FORMAT_VERSION,
  asJsonObject,
  cloneJsonValue,
  decodeSceneDocument,
  encodeSceneDocument,
  isJsonArray,
  isJsonObject,
  validateQuaternionDocument,
  validateSceneDocument,
  validateVector3Document,
  type SceneDocument,
} from "../src/index.js";

/** A minimal valid document: one empty group. */
function document(node: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: SCENE_FORMAT_VERSION,
    nodes: [{ type: "group", ...node }],
  };
}

/** The single root of a validated document. */
function root(value: Record<string, unknown>): Record<string, unknown> {
  return validateSceneDocument(value).nodes[0] as unknown as Record<
    string,
    unknown
  >;
}

describe("cloneJsonValue", () => {
  it("copies primitives, arrays, and plain objects", () => {
    const source = { a: 1, b: "two", c: true, d: null, e: [1, [2]], f: {} };
    const clone = cloneJsonValue(source);

    expect(clone).toEqual(source);
    expect(clone).not.toBe(source);
    expect(Object.isFrozen(clone)).toBe(true);
  });

  it("normalizes -0 to 0", () => {
    expect(Object.is(cloneJsonValue(-0), 0)).toBe(true);
  });

  it("refuses values JSON cannot represent", () => {
    expect(() => cloneJsonValue(Number.NaN, "x")).toThrow(
      /x is NaN, which JSON cannot represent/,
    );
    expect(() => cloneJsonValue(Number.POSITIVE_INFINITY, "x")).toThrow(
      TypeError,
    );
    expect(() => cloneJsonValue(() => 0, "x")).toThrow(
      /x is a function, which JSON cannot represent/,
    );
    expect(() => cloneJsonValue(new Map(), "x")).toThrow(
      /x is \[object Map\], not a plain object/,
    );
    expect(() => cloneJsonValue({ a: undefined }, "x")).toThrow(
      /x\.a is undefined; JSON would drop the key/,
    );
  });

  it("refuses a cycle, naming where it closes", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => cloneJsonValue(cyclic, "x")).toThrow(
      /x\.self is a circular reference/,
    );

    const shared = { a: 1 };
    // The same object twice is not a cycle: the ancestor set unwinds.
    expect(cloneJsonValue({ first: shared, second: shared })).toEqual({
      first: { a: 1 },
      second: { a: 1 },
    });
  });

  it("refuses a __proto__ key rather than re-parenting the copy", () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    expect(Object.hasOwn(parsed as object, "__proto__")).toBe(true);

    expect(() => cloneJsonValue(parsed, "metadata")).toThrow(
      /metadata has a "__proto__" key/,
    );
    expect(
      (Object.prototype as unknown as { polluted?: boolean }).polluted,
    ).toBeUndefined();
  });

  it("accepts a null-prototype object", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.a = 1;
    expect(cloneJsonValue(bare)).toEqual({ a: 1 });
  });

  it("names the path of a nested offence", () => {
    expect(() => cloneJsonValue({ a: [{ b: Number.NaN }] }, "data")).toThrow(
      /data\.a\[0\]\.b is NaN/,
    );
  });
});

describe("JSON guards", () => {
  it("separate arrays, objects, and primitives", () => {
    expect(isJsonArray([1, 2])).toBe(true);
    expect(isJsonArray({})).toBe(false);
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([1])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject(3)).toBe(false);
  });

  it("asJsonObject clones and refuses non-objects", () => {
    expect(asJsonObject({ a: 1 }, "data")).toEqual({ a: 1 });
    expect(() => asJsonObject([1], "data")).toThrow(/data must be an object/);
    expect(() => asJsonObject(null, "data")).toThrow(/data must be an object/);
  });
});

describe("vector and quaternion documents", () => {
  it("validate their components and normalize -0", () => {
    expect(validateVector3Document({ x: 1, y: -0, z: 3 }, "v")).toEqual({
      x: 1,
      y: 0,
      z: 3,
    });
    expect(validateQuaternionDocument({ x: 0, y: 0, z: 0, w: 1 }, "q")).toEqual(
      { x: 0, y: 0, z: 0, w: 1 },
    );
  });

  it("refuse a missing or non-finite component, naming it", () => {
    expect(() => validateVector3Document({ x: 1, y: 2 }, "v")).toThrow(
      /v\.z must be a finite number/,
    );
    expect(() => validateVector3Document("nope", "v")).toThrow(
      /v must be an object/,
    );
    expect(() =>
      validateQuaternionDocument({ x: 0, y: 0, z: 0, w: Number.NaN }, "q"),
    ).toThrow(/q\.w must be a finite number/);
  });
});

describe("validateSceneDocument", () => {
  it("accepts a minimal document and freezes it", () => {
    const value = validateSceneDocument(document());

    expect(value).toEqual({
      formatVersion: SCENE_FORMAT_VERSION,
      nodes: [{ type: "group" }],
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nodes)).toBe(true);
    expect(Object.isFrozen(value.nodes[0])).toBe(true);
  });

  it("accepts a document with no nodes at all", () => {
    expect(
      validateSceneDocument({ formatVersion: SCENE_FORMAT_VERSION, nodes: [] })
        .nodes,
    ).toEqual([]);
  });

  it("refuses a formatVersion this build does not read", () => {
    let thrown: unknown;
    try {
      validateSceneDocument({ formatVersion: 2, nodes: [] });
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    expect(isFourError(thrown) && thrown.code).toBe(
      "SERIALIZATION_VERSION_MISMATCH",
    );
    expect(isFourError(thrown) && thrown.context).toEqual({
      expected: SCENE_FORMAT_VERSION,
      found: 2,
    });
  });

  it("refuses a document that is not an object with an array of nodes", () => {
    expect(() => validateSceneDocument([])).toThrow(
      /document must be an object/,
    );
    expect(() => validateSceneDocument(null)).toThrow(
      /document must be an object/,
    );
    expect(() =>
      validateSceneDocument({ formatVersion: SCENE_FORMAT_VERSION }),
    ).toThrow(/document\.nodes must be an array/);
    expect(() => validateSceneDocument({ nodes: [] })).toThrow(
      /document\.formatVersion must be a finite number/,
    );
  });

  it("drops unknown fields, including an injected __proto__", () => {
    const text = `{"__proto__":{"polluted":true},"formatVersion":${String(SCENE_FORMAT_VERSION)},"nodes":[{"type":"group","surprise":1}]}`;
    const parsed = JSON.parse(text) as unknown;
    expect(Object.hasOwn(parsed as object, "__proto__")).toBe(true);

    const value = validateSceneDocument(parsed);

    expect(Object.hasOwn(value, "__proto__")).toBe(false);
    expect(
      (value.nodes[0] as unknown as Record<string, unknown>).surprise,
    ).toBeUndefined();
  });

  it("refuses a node with no type", () => {
    expect(() =>
      validateSceneDocument({ formatVersion: 1, nodes: [{}] }),
    ).toThrow(/document\.nodes\[0\]\.type must be a string/);
    expect(() =>
      validateSceneDocument({ formatVersion: 1, nodes: [{ type: "" }] }),
    ).toThrow(/document\.nodes\[0\]\.type must not be empty/);
    expect(() =>
      validateSceneDocument({ formatVersion: 1, nodes: ["group"] }),
    ).toThrow(/document\.nodes\[0\] must be an object/);
  });

  it("keeps identity and refuses duplicate or empty ids", () => {
    expect(root(document({ id: "node-7" })).id).toBe("node-7");
    expect(() => validateSceneDocument(document({ id: "" }))).toThrow(
      /document\.nodes\[0\]\.id must not be empty/,
    );
    expect(() => validateSceneDocument(document({ id: 7 }))).toThrow(
      /document\.nodes\[0\]\.id must be a string/,
    );
    expect(() =>
      validateSceneDocument({
        formatVersion: 1,
        nodes: [
          { type: "group", id: "a", children: [{ type: "group", id: "a" }] },
        ],
      }),
    ).toThrow(/already uses; node ids are unique/);
  });

  it("drops a name, visibility, enablement, and opacity at their defaults", () => {
    expect(
      root(
        document({
          name: "",
          visible: true,
          enabled: true,
          opacity: 1,
          tags: [],
          metadata: {},
          components: [],
          children: [],
        }),
      ),
    ).toEqual({ type: "group" });
  });

  it("keeps them when they differ from the default", () => {
    expect(
      root(
        document({
          name: "hero",
          visible: false,
          enabled: false,
          opacity: 0.25,
          tags: ["a", "b"],
          metadata: { level: 3 },
        }),
      ),
    ).toEqual({
      name: "hero",
      type: "group",
      visible: false,
      enabled: false,
      opacity: 0.25,
      tags: ["a", "b"],
      metadata: { level: 3 },
    });
  });

  it("refuses mistyped node fields", () => {
    expect(() => validateSceneDocument(document({ name: 1 }))).toThrow(
      /document\.nodes\[0\]\.name must be a string/,
    );
    expect(() => validateSceneDocument(document({ visible: "yes" }))).toThrow(
      /document\.nodes\[0\]\.visible must be a boolean/,
    );
    expect(() => validateSceneDocument(document({ enabled: 0 }))).toThrow(
      /document\.nodes\[0\]\.enabled must be a boolean/,
    );
    expect(() =>
      validateSceneDocument(document({ opacity: Number.NaN })),
    ).toThrow(/document\.nodes\[0\]\.opacity must be a finite number/);
    expect(() => validateSceneDocument(document({ metadata: [1] }))).toThrow(
      /document\.nodes\[0\]\.metadata must be an object/,
    );
    expect(() =>
      validateSceneDocument(document({ metadata: { when: new Date(0) } })),
    ).toThrow(/document\.nodes\[0\]\.metadata\.when is \[object Date\]/);
    expect(() => validateSceneDocument(document({ children: {} }))).toThrow(
      /document\.nodes\[0\]\.children must be an array/,
    );
  });

  it("refuses tags that are not a unique list of non-empty strings", () => {
    expect(() => validateSceneDocument(document({ tags: "a" }))).toThrow(
      /document\.nodes\[0\]\.tags must be an array/,
    );
    expect(() => validateSceneDocument(document({ tags: [""] }))).toThrow(
      /document\.nodes\[0\]\.tags\[0\] must not be empty/,
    );
    expect(() => validateSceneDocument(document({ tags: ["a", "a"] }))).toThrow(
      /repeats the tag "a"; tags are a set/,
    );
  });

  it("validates the §42 transform authority and drops the default", () => {
    expect(root(document({ transformAuthority: "manual" }))).toEqual({
      type: "group",
    });
    expect(
      root(document({ transformAuthority: "physics" })).transformAuthority,
    ).toBe("physics");
    expect(() =>
      validateSceneDocument(document({ transformAuthority: "solver" })),
    ).toThrow(/expected one of manual, animation, kinematic/);
    expect(() =>
      validateSceneDocument(document({ transformAuthority: 3 })),
    ).toThrow(/document\.nodes\[0\]\.transformAuthority must be a string/);
  });

  it("drops an identity transform entirely", () => {
    expect(
      root(
        document({
          transform: {
            position: { x: 0, y: -0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            pivot: { x: 0, y: 0, z: 0 },
            matrixAutoUpdate: true,
          },
        }),
      ),
    ).toEqual({ type: "group" });
  });

  it("keeps every non-default transform field", () => {
    expect(
      root(
        document({
          transform: {
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 1, z: 0, w: 0 },
            scale: { x: 2, y: 2, z: 2 },
            pivot: { x: 0, y: 0.5, z: 0 },
          },
        }),
      ).transform,
    ).toEqual({
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 1, z: 0, w: 0 },
      scale: { x: 2, y: 2, z: 2 },
      pivot: { x: 0, y: 0.5, z: 0 },
    });
  });

  it("carries a user-owned local matrix only with matrixAutoUpdate false", () => {
    const elements = Array.from({ length: 16 }, (_, i) => i);
    expect(
      root(
        document({
          transform: { matrixAutoUpdate: false, localMatrix: elements },
        }),
      ).transform,
    ).toEqual({ matrixAutoUpdate: false, localMatrix: elements });

    expect(() =>
      validateSceneDocument(document({ transform: { localMatrix: elements } })),
    ).toThrow(/localMatrix is only recorded with "matrixAutoUpdate": false/);
  });

  it("refuses a malformed transform", () => {
    expect(() => validateSceneDocument(document({ transform: 3 }))).toThrow(
      /document\.nodes\[0\]\.transform must be an object/,
    );
    expect(() =>
      validateSceneDocument(
        document({ transform: { matrixAutoUpdate: "off" } }),
      ),
    ).toThrow(/transform\.matrixAutoUpdate must be a boolean/);
    expect(() =>
      validateSceneDocument(
        document({ transform: { matrixAutoUpdate: false, localMatrix: [1] } }),
      ),
    ).toThrow(/localMatrix must hold 16 column-major elements \(got 1\)/);
    expect(() =>
      validateSceneDocument(
        document({
          transform: { matrixAutoUpdate: false, localMatrix: "identity" },
        }),
      ),
    ).toThrow(/transform\.localMatrix must be an array/);
    expect(() =>
      validateSceneDocument(
        document({
          transform: {
            matrixAutoUpdate: false,
            localMatrix: Array.from({ length: 16 }, () => Number.NaN),
          },
        }),
      ),
    ).toThrow(/transform\.localMatrix\[0\] must be a finite number/);
    expect(() =>
      validateSceneDocument(document({ transform: { position: [1, 2, 3] } })),
    ).toThrow(/transform\.position must be an object/);
  });

  it("carries component payloads opaquely, unknown types included", () => {
    const node = root(
      document({
        components: [
          { type: "pose-target", data: { position: { x: 0, y: 1, z: 0 } } },
          { type: "com.example.health", data: { hp: 3 } },
          { type: "stateless" },
        ],
      }),
    );

    expect(node.components).toEqual([
      { type: "pose-target", data: { position: { x: 0, y: 1, z: 0 } } },
      { type: "com.example.health", data: { hp: 3 } },
      { type: "stateless", data: null },
    ]);
  });

  it("refuses malformed components", () => {
    expect(() => validateSceneDocument(document({ components: {} }))).toThrow(
      /document\.nodes\[0\]\.components must be an array/,
    );
    expect(() =>
      validateSceneDocument(document({ components: [{ data: 1 }] })),
    ).toThrow(/components\[0\]\.type must be a string/);
    expect(() =>
      validateSceneDocument(
        document({ components: [{ type: "a" }, { type: "a" }] }),
      ),
    ).toThrow(/which this node already carries/);
    expect(() =>
      validateSceneDocument(
        document({ components: [{ type: "a", data: { when: new Date(0) } }] }),
      ),
    ).toThrow(/components\[0\]\.data\.when is \[object Date\]/);
  });

  it("validates children recursively, naming the path", () => {
    expect(() =>
      validateSceneDocument(
        document({
          children: [{ type: "group", children: [{ type: "group", tags: 1 }] }],
        }),
      ),
    ).toThrow(
      /document\.nodes\[0\]\.children\[0\]\.children\[0\]\.tags must be an array/,
    );
  });

  it("is idempotent — validating a canonical document changes nothing", () => {
    const once = validateSceneDocument(
      document({
        id: "node-1",
        name: "root",
        tags: ["a"],
        transform: { position: { x: 1, y: 0, z: 0 } },
        components: [{ type: "x", data: [1, { y: 2 }] }],
        children: [{ type: "group", id: "node-2", opacity: 0.5 }],
      }),
    );
    const twice = validateSceneDocument(once);

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("puts keys in one fixed order however they arrive", () => {
    const shuffled = validateSceneDocument({
      nodes: [
        {
          children: [],
          components: [],
          opacity: 0.5,
          type: "group",
          name: "n",
          id: "node-3",
          visible: false,
          transformAuthority: "physics",
        },
      ],
      formatVersion: SCENE_FORMAT_VERSION,
    });

    expect(JSON.stringify(shuffled)).toBe(
      '{"formatVersion":1,"nodes":[{"id":"node-3","name":"n","type":"group","transformAuthority":"physics","visible":false,"opacity":0.5}]}',
    );
  });
});

describe("encodeSceneDocument / decodeSceneDocument", () => {
  const text =
    '{"formatVersion":1,"nodes":[{"id":"node-1","name":"root","type":"scene","transform":{"position":{"x":1,"y":2,"z":3}},"transformAuthority":"kinematic","visible":false,"enabled":false,"opacity":0.5,"tags":["a"],"metadata":{"k":[1,null,"two"]},"components":[{"type":"pose-target","data":{"position":{"x":0,"y":1,"z":0},"rotation":{"x":0,"y":0,"z":0,"w":1}}}],"children":[{"id":"node-2","type":"group"}]}]}';

  it("round-trips text byte for byte", () => {
    expect(encodeSceneDocument(decodeSceneDocument(text))).toBe(text);
  });

  it("validates on the way out", () => {
    const broken = {
      formatVersion: SCENE_FORMAT_VERSION,
      nodes: [{ type: "group", opacity: Number.NaN }],
    } as unknown as SceneDocument;
    expect(() => encodeSceneDocument(broken)).toThrow(
      /opacity must be a finite number/,
    );
  });

  it("propagates a syntax error from the text itself", () => {
    expect(() => decodeSceneDocument("{")).toThrow(SyntaxError);
  });
});

describe("string field ceiling (§96, 2026-09-11)", () => {
  it("refuses a node id over 4096 characters", () => {
    expect(() =>
      decodeSceneDocument(
        JSON.stringify({
          formatVersion: SCENE_FORMAT_VERSION,
          nodes: [{ id: "n".repeat(4097), type: "group" }],
        }),
      ),
    ).toThrow(/over the 4096-character limit/);
  });
});
