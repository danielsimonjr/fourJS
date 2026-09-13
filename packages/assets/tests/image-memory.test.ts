import { describe, expect, it } from "vitest";

import {
  assertImageDecoderMemory,
  registerBoundedImageDecoder,
} from "../src/image-memory.js";

describe("image decoder memory capabilities", () => {
  it("requires the registered function itself and a sufficient requested limit", () => {
    const decode = registerBoundedImageDecoder(() => undefined, 131_072);
    expect(registerBoundedImageDecoder(decode, 131_072)).toBe(decode);
    expect(() => assertImageDecoderMemory(decode, 131_072)).not.toThrow();
    expect(() => assertImageDecoderMemory(decode, 262_144)).not.toThrow();
    expect(() => assertImageDecoderMemory(decode, 65_536)).toThrow(
      /ceiling exceeds/,
    );
    expect(() => assertImageDecoderMemory(() => decode(), 131_072)).toThrow(
      /no enforceable/,
    );
    expect(() =>
      assertImageDecoderMemory(
        Object.assign(() => undefined, { maximumWorkingBytes: 65_536 }),
        131_072,
      ),
    ).toThrow(/no enforceable/);
  });

  it("cannot relabel an existing capability with a smaller ceiling", () => {
    const decode = registerBoundedImageDecoder(() => undefined, 131_072);
    expect(() => registerBoundedImageDecoder(decode, 65_536)).toThrow(
      /cannot be changed/,
    );
    expect(() => assertImageDecoderMemory(decode, 65_536)).toThrow();
  });

  it.each([0, -1, 65_535, 65_536.5, 4_294_967_297, NaN, Infinity])(
    "rejects invalid requested or registered cap %s",
    (limit) => {
      expect(() => assertImageDecoderMemory(undefined, limit)).toThrow(
        /safe integer/,
      );
      expect(() => registerBoundedImageDecoder(() => undefined, limit)).toThrow(
        /safe integer/,
      );
    },
  );

  it("permits an omitted hard limit and texture-free documents", () => {
    expect(() =>
      assertImageDecoderMemory(() => undefined, undefined),
    ).not.toThrow();
    expect(() => assertImageDecoderMemory(undefined, 65_536)).not.toThrow();
    const decode = registerBoundedImageDecoder(() => undefined, 4_294_967_296);
    expect(() => assertImageDecoderMemory(decode, 4_294_967_296)).not.toThrow();
  });
});
