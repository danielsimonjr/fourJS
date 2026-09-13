import { describe, expect, it } from "vitest";

import { cloneJsonValue } from "../src/json.js";

describe("cloneJsonValue (§34/§79 shared JSON validation)", () => {
  it("returns primitives unchanged", () => {
    expect(cloneJsonValue(null)).toBeNull();
    expect(cloneJsonValue(true)).toBe(true);
    expect(cloneJsonValue(false)).toBe(false);
    expect(cloneJsonValue("text")).toBe("text");
    expect(cloneJsonValue("")).toBe("");
    expect(cloneJsonValue(0.5)).toBe(0.5);
    expect(cloneJsonValue(-3)).toBe(-3);
  });

  it("normalizes -0 to 0, matching JSON.stringify and the §33 checksum", () => {
    expect(Object.is(cloneJsonValue(-0), 0)).toBe(true);
    expect(Object.is(cloneJsonValue(0), 0)).toBe(true);
  });

  it("refuses non-finite numbers, which JSON would round-trip as null", () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(() => cloneJsonValue(value)).toThrow(TypeError);
      expect(() => cloneJsonValue(value)).toThrow(/JSON cannot represent/);
    }
  });

  it("refuses values whose typeof JSON cannot represent", () => {
    expect(() => cloneJsonValue(undefined)).toThrow(/is a undefined/);
    expect(() => cloneJsonValue(() => 0)).toThrow(/is a function/);
    expect(() => cloneJsonValue(Symbol("s"))).toThrow(/is a symbol/);
    expect(() => cloneJsonValue(1n)).toThrow(/is a bigint/);
  });

  it("deep-copies arrays and objects rather than referencing them", () => {
    const source = { list: [1, "two", null], nested: { ok: true } };
    const copy = cloneJsonValue(source) as typeof source;

    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.list).not.toBe(source.list);
    expect(copy.nested).not.toBe(source.nested);
  });

  it("freezes every level of the copy", () => {
    const copy = cloneJsonValue({ a: [{ b: 1 }] }) as {
      a: readonly [{ b: number }];
    };

    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.a)).toBe(true);
    expect(Object.isFrozen(copy.a[0])).toBe(true);
  });

  it("preserves own enumerable key insertion order, like JSON.stringify", () => {
    const copy = cloneJsonValue({ z: 1, a: 2, m: 3 });

    expect(Object.keys(copy as object)).toEqual(["z", "a", "m"]);
  });

  it("refuses a circular reference with the path that closed the cycle", () => {
    const ring: { self?: unknown } = {};
    ring.self = ring;

    expect(() => cloneJsonValue(ring, "payload")).toThrow(
      /payload\.self is a circular reference/,
    );
  });

  it("allows the same object twice on non-overlapping branches", () => {
    const shared = { leaf: true };
    const copy = cloneJsonValue({ a: shared, b: shared }) as {
      a: { leaf: boolean };
      b: { leaf: boolean };
    };

    expect(copy.a).toEqual(shared);
    expect(copy.b).toEqual(shared);
    expect(copy.a).not.toBe(copy.b);
  });

  it("refuses non-plain objects, naming their toString tag", () => {
    expect(() => cloneJsonValue(new Date(0))).toThrow(/not a plain object/);
    expect(() => cloneJsonValue(new Map())).toThrow(/not a plain object/);
    class Custom {}
    expect(() => cloneJsonValue(new Custom())).toThrow(/not a plain object/);
  });

  it("accepts a null-prototype object, which JSON.parse reviver flows produce", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.key = "value";

    expect(cloneJsonValue(bare)).toEqual({ key: "value" });
  });

  it("refuses an undefined property, which JSON would silently drop", () => {
    expect(() => cloneJsonValue({ gap: undefined }, "doc")).toThrow(
      /doc\.gap is undefined/,
    );
  });

  it('refuses a "__proto__" key rather than re-parenting the copy', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}') as object;
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);

    expect(() => cloneJsonValue(parsed, "payload")).toThrow(
      /payload has a "__proto__" key/,
    );
  });

  it("reports array indices and nested keys in error paths", () => {
    expect(() => cloneJsonValue([1, Number.NaN], "doc")).toThrow(/doc\[1\]/);
    expect(() => cloneJsonValue({ outer: { inner: undefined } })).toThrow(
      /value\.outer\.inner/,
    );
  });
});

describe("cloneJsonValue depth ceiling (§96, 2026-09-11)", () => {
  it("refuses a value nested deeper than 1024 levels with UNTRUSTED_INPUT_REJECTED", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 1100; i += 1) {
      deep = [deep];
    }
    expect(() => cloneJsonValue(deep)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }) as Error,
    );
  });

  it("accepts 1024 levels exactly", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 1023; i += 1) {
      deep = [deep];
    }
    expect(cloneJsonValue(deep)).toBeDefined();
  });
});
