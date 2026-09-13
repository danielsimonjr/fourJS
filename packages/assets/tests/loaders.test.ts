import { afterEach, describe, expect, it, vi } from "vitest";
import { registerBoundedImageDecoder } from "../src/image-memory.js";

afterEach(() => {
  vi.restoreAllMocks();
});

import {
  AssetManager,
  ImageAsset,
  binaryLoader,
  createImageLoader,
  jsonLoader,
  textLoader,
  type FetchLike,
  type FetchResponse,
  type ImageBitmapLike,
} from "../src/index.js";

/** A `FetchResponse` whose body is the given bytes. */
function bytesResponse(bytes: Uint8Array): FetchResponse {
  const buffer = bytes.slice().buffer;
  const text = new TextDecoder().decode(bytes);
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
    // Deferred, exactly as a real `Response.json()` behaves: a malformed body
    // rejects the promise, it does not throw synchronously.
    json: () => Promise.resolve().then(() => JSON.parse(text) as unknown),
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

function textResponse(body: string): FetchResponse {
  return bytesResponse(new TextEncoder().encode(body));
}

function fetchOf(bodies: Record<string, string>): FetchLike {
  return (url: string) => {
    const body = bodies[url];
    if (body === undefined) {
      throw new Error(`unexpected url ${url}`);
    }
    return Promise.resolve(textResponse(body));
  };
}

/** A `createImageBitmap`-like fake: decodes "WxH" from the body bytes. */
function fakeDecode(): {
  decode: (data: ArrayBuffer) => Promise<ImageBitmapLike>;
  closed: number[];
  calls: number;
} {
  const state = {
    closed: [] as number[],
    calls: 0,
    decode: (data: ArrayBuffer): Promise<ImageBitmapLike> => {
      state.calls += 1;
      const [width, height] = new TextDecoder()
        .decode(new Uint8Array(data))
        .split("x")
        .map((part) => Number.parseInt(part, 10));
      const id = state.calls;
      return Promise.resolve({
        width: width ?? 0,
        height: height ?? 0,
        close(): void {
          state.closed.push(id);
        },
      });
    },
  };
  return state;
}

describe("body loaders", () => {
  it("textLoader returns the body as text", async () => {
    await expect(
      textLoader.load(textResponse("hello"), "/a.txt"),
    ).resolves.toBe("hello");
    expect(textLoader.name).toBe("text");
  });

  it("jsonLoader returns parsed, unnarrowed JSON", async () => {
    const value = await jsonLoader.load(
      textResponse('{"level":2,"tags":["a"]}'),
      "/a.json",
    );

    expect(value).toEqual({ level: 2, tags: ["a"] });
    expect(jsonLoader.name).toBe("json");
  });

  it("jsonLoader propagates a parse failure", async () => {
    await expect(
      jsonLoader.load(textResponse("not json"), "/a.json"),
    ).rejects.toThrow(SyntaxError);
  });

  it("binaryLoader returns the raw bytes", async () => {
    const source = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

    const buffer = await binaryLoader.load(bytesResponse(source), "/a.glb");

    expect(new Uint8Array(buffer)).toEqual(source);
    expect(binaryLoader.name).toBe("binary");
  });
});

describe("createImageLoader", () => {
  it("decodes through the injected decoder and exposes dimensions", async () => {
    const fake = fakeDecode();
    // This synthetic codec expands five ASCII bytes into a 64×32 bitmap.
    const loader = createImageLoader(fake.decode, {
      maximumExpansionRatio: Infinity,
    });

    const asset = await loader.load(textResponse("64x32"), "/icon.png");

    expect(loader.name).toBe("image");
    expect(fake.calls).toBe(1);
    expect(asset).toBeInstanceOf(ImageAsset);
    expect(asset.width).toBe(64);
    expect(asset.height).toBe(32);
    expect(asset.isDisposed).toBe(false);
  });

  it("accepts a synchronous decoder and a custom name", async () => {
    const bitmap: ImageBitmapLike = {
      width: 4,
      height: 4,
      close: () => undefined,
    };
    const loader = createImageLoader(() => bitmap, "image:sync");

    const asset = await loader.load(textResponse("ignored"), "/icon.png");

    expect(loader.name).toBe("image:sync");
    expect(asset.bitmap).toBe(bitmap);
  });

  it("closes the bitmap once, from dispose or close", async () => {
    const fake = fakeDecode();
    const loader = createImageLoader(fake.decode);

    const asset = await loader.load(textResponse("8x8"), "/icon.png");
    asset.dispose();
    asset.dispose();
    asset.close();

    expect(fake.closed).toEqual([1]);
    expect(asset.isDisposed).toBe(true);
  });

  it("closes through the manager's refcount when the last reference goes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeDecode();
    const loader = createImageLoader(fake.decode);
    const manager = new AssetManager({ fetch: fetchOf({ "/i.png": "16x8" }) });

    const asset = await manager.load("/i.png", loader);
    await manager.load("/i.png", loader);
    expect(fake.calls).toBe(1);

    expect(manager.release("/i.png", loader)).toBe(false);
    expect(fake.closed).toEqual([]);
    expect(manager.release("/i.png", loader)).toBe(true);

    expect(fake.closed).toEqual([1]);
    expect(asset.isDisposed).toBe(true);
  });

  it("gives each factory call its own cache slot", async () => {
    const fake = fakeDecode();
    const first = createImageLoader(fake.decode);
    const second = createImageLoader(fake.decode);
    const manager = new AssetManager({ fetch: fetchOf({ "/i.png": "2x2" }) });

    const a = await manager.load("/i.png", first);
    const b = await manager.load("/i.png", second);

    expect(a).not.toBe(b);
    expect(fake.calls).toBe(2);
    expect(manager.size).toBe(2);
  });
});

describe("image loader security limits", () => {
  it.each(["probe", "decode"] as const)(
    "preserves the expansion limit when the %s transfers the input and closes rejected output",
    async (stage) => {
      const close = vi.fn();
      const detach = (data: ArrayBuffer): void => {
        structuredClone(data, { transfer: [data] });
      };
      const loader = createImageLoader(
        (data) => {
          if (stage === "decode") detach(data);
          return { width: 2, height: 2, close };
        },
        {
          maximumExpansionRatio: 2,
          probe: (data) => {
            if (stage === "probe") detach(data);
            return undefined;
          },
        },
      );
      await expect(
        loader.load(textResponse("data"), "/transfer.png"),
      ).rejects.toMatchObject({
        context: {
          url: "/transfer.png",
          stage: "decode",
          encodedBytes: 4,
          maximumExpansionRatio: 2,
        },
      });
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("refuses an unbounded decoder before fetching and accepts a registered one", async () => {
    const decode = vi.fn(() => ({ width: 1, height: 1, close: vi.fn() }));
    expect(() =>
      createImageLoader(decode, { maximumWorkingBytes: 65_536 }),
    ).toThrow(/no enforceable/);
    expect(decode).not.toHaveBeenCalled();
    registerBoundedImageDecoder(decode, 65_536);
    const loader = createImageLoader(decode, {
      name: "bounded-image",
      maximumWorkingBytes: 65_536,
    });
    const asset = await loader.load(textResponse("data"), "/x.png");
    expect(loader.name).toBe("bounded-image");
    expect(asset.width).toBe(1);
    asset.dispose();
    expect(decode.mock.results[0].value.close).toHaveBeenCalledOnce();
  });

  it.each(["maximumDecodedBytes", "maximumExpansionRatio"] as const)(
    "rejects an invalid %s before decode",
    (limit) => {
      expect(() =>
        createImageLoader(fakeDecode().decode, { [limit]: NaN }),
      ).toThrow(/must be greater than zero/);
    },
  );

  it("checks output size and closes rejected bitmaps exactly once", async () => {
    const close = vi.fn();
    const loader = createImageLoader(() => ({ width: 2, height: 2, close }), {
      maximumDecodedBytes: 8,
    });
    await expect(loader.load(textResponse("data"), "/x.png")).rejects.toThrow(
      /decoded-byte or expansion limits/,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("checks expansion ratio and preserves the failure if close throws", async () => {
    const close = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const loader = createImageLoader(() => ({ width: 2, height: 2, close }), {
      maximumExpansionRatio: 2,
    });
    await expect(loader.load(textResponse("data"), "/x.png")).rejects.toThrow(
      /decoded-byte or expansion limits/,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects excessive or unknown probes before decode", async () => {
    const decode = vi.fn(() => ({ width: 1, height: 1, close: vi.fn() }));
    const excessive = createImageLoader(decode, {
      probe: () => ({ width: 30_000, height: 30_000 }),
    });
    await expect(
      excessive.load(textResponse("data"), "/x.png"),
    ).rejects.toThrow(/decoded-byte or expansion limits/);
    const unknown = createImageLoader(decode, {
      requireProbe: true,
      probe: () => undefined,
    });
    await expect(unknown.load(textResponse("data"), "/x.png")).rejects.toThrow(
      /recognized dimension probe/,
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    { width: NaN, height: 1 },
    { width: 0, height: 1 },
    { width: 1, height: 1.5 },
    { width: 1, height: 0 },
    { width: Number.MAX_SAFE_INTEGER, height: 2 },
  ])(
    "rejects invalid bitmap dimensions %o and closes it",
    async (dimensions) => {
      const close = vi.fn();
      const loader = createImageLoader(() => ({ ...dimensions, close }));
      await expect(loader.load(textResponse("data"), "/x.png")).rejects.toThrow(
        /positive safe integers/,
      );
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("accepts recognized probes and snapshots limits against caller mutation", async () => {
    const options = {
      requireProbe: true,
      probe: () => ({ width: 1, height: 1 }),
      maximumDecodedBytes: 4,
    };
    const loader = createImageLoader(
      () => ({ width: 1, height: 1, close: vi.fn() }),
      options,
    );
    options.maximumDecodedBytes = 1;
    options.probe = () => ({ width: 0, height: 0 });
    await expect(
      loader.load(textResponse(""), "/x.png"),
    ).resolves.toBeInstanceOf(ImageAsset);
  });
});

describe("loaders as asset-manager keys", () => {
  it("round-trips text, JSON, and binary through the manager", async () => {
    const manager = new AssetManager({
      fetch: fetchOf({
        "/a.txt": "alpha",
        "/a.json": '{"ok":true}',
        "/a.glb": "glTF",
      }),
    });

    expect(await manager.load("/a.txt", textLoader)).toBe("alpha");
    expect(await manager.load("/a.json", jsonLoader)).toEqual({ ok: true });
    expect(
      new TextDecoder().decode(await manager.load("/a.glb", binaryLoader)),
    ).toBe("glTF");
    expect(manager.size).toBe(3);
  });
});
