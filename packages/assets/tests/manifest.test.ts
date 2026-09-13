import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  AssetManager,
  binaryLoader,
  loadFromManifest,
  manifestLoader,
  manifestUrl,
  parseAssetManifest,
  textLoader,
  type AssetManifest,
  type FetchResponse,
} from "../src/index.js";

function response(body: string): FetchResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
}

function fetchOf(
  bodies: Record<string, string>,
): (url: string) => Promise<FetchResponse> {
  return (url: string) => {
    const body = bodies[url];
    if (body === undefined) {
      return Promise.reject(new Error(`unexpected url ${url}`));
    }
    return Promise.resolve(response(body));
  };
}

const HASH_OF_ABC =
  "sha256-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("parseAssetManifest", () => {
  it("accepts a §79 manifest and refuses everything else", () => {
    const good = parseAssetManifest({
      robot: { url: "/models/robot.bin", hash: HASH_OF_ABC },
      icon: { url: "/icon.png" },
    });
    expect(good.robot?.url).toBe("/models/robot.bin");
    expect(good.icon?.hash).toBeUndefined();

    for (const bad of [null, [], "manifest", 7]) {
      expect(() => parseAssetManifest(bad, "/assets.json")).toThrow(
        /not a §79 asset manifest/,
      );
    }
    expect(() => parseAssetManifest({ a: "url" })).toThrow(/not an object/);
    expect(() => parseAssetManifest({ a: [] })).toThrow(/not an object/);
    expect(() => parseAssetManifest({ a: {} })).toThrow(/has no url/);
    expect(() => parseAssetManifest({ a: { url: "" } })).toThrow(/has no url/);
    expect(() => parseAssetManifest({ a: { url: "/x", hash: 1 } })).toThrow(
      /non-string hash/,
    );
  });

  it("names the offending key in the error context (§85)", () => {
    try {
      parseAssetManifest({ robot: {} }, "/assets.json");
      throw new Error("expected a rejection");
    } catch (error) {
      expect(isFourError(error) && error.context).toMatchObject({
        source: "/assets.json",
        key: "robot",
      });
    }
  });
});

describe("manifestLoader", () => {
  it("loads and validates a manifest document", async () => {
    const assets = new AssetManager({
      fetch: fetchOf({
        "/assets.json": JSON.stringify({ robot: { url: "/robot.bin" } }),
        "/bad.json": "[]",
      }),
    });
    const manifest = await assets.load("/assets.json", manifestLoader);
    expect(manifestUrl(manifest, "robot")).toBe("/robot.bin");
    expect(manifestUrl(manifest, "absent")).toBeUndefined();

    await expect(assets.load("/bad.json", manifestLoader)).rejects.toThrow(
      /not a §79 asset manifest/,
    );
  });
});

describe("loadFromManifest", () => {
  const manifest: AssetManifest = {
    robot: { url: "/robot.txt", hash: HASH_OF_ABC },
    stale: { url: "/robot.txt", hash: "sha256-00" },
    plain: { url: "/plain.txt" },
  };

  function manager(): AssetManager {
    return new AssetManager({
      fetch: fetchOf({ "/robot.txt": "abc", "/plain.txt": "xyz" }),
    });
  }

  it("resolves a key, verifies the bytes, and takes one reference", async () => {
    const assets = manager();
    await expect(
      loadFromManifest(assets, manifest, "robot", textLoader),
    ).resolves.toBe("abc");
    expect(assets.contentHash("/robot.txt", textLoader)).toBe(HASH_OF_ABC);
    expect(assets.refCount("/robot.txt", textLoader)).toBe(1);
    assets.release(manifestUrl(manifest, "robot") ?? "", textLoader);
    expect(assets.size).toBe(0);
  });

  it("refuses bytes that are not the bytes the manifest named (§96)", async () => {
    const assets = manager();
    await expect(
      loadFromManifest(assets, manifest, "stale", binaryLoader),
    ).rejects.toThrow(/hashes to/);
    expect(assets.size).toBe(0);
  });

  it("loads a hashless row, unless requireHash says not to", async () => {
    const assets = manager();
    await expect(
      loadFromManifest(assets, manifest, "plain", textLoader),
    ).resolves.toBe("xyz");
    expect(assets.contentHash("/plain.txt", textLoader)).toBeUndefined();

    expect(() =>
      loadFromManifest(assets, manifest, "plain", textLoader, {
        requireHash: true,
      }),
    ).toThrow(/declares no content hash/);
  });

  it("records the hash of a hashless row when asked to", async () => {
    const assets = manager();
    await loadFromManifest(assets, manifest, "plain", textLoader, {
      hashContent: true,
    });
    expect(assets.contentHash("/plain.txt", textLoader)).toMatch(/^sha256-/);
  });

  it("refuses an unknown key at the call", () => {
    expect(() =>
      loadFromManifest(manager(), manifest, "ghost", textLoader),
    ).toThrow(/names no key "ghost"/);
  });

  it("passes a cancellation signal through", async () => {
    const controller = new AbortController();
    const assets = manager();
    const pending = loadFromManifest(assets, manifest, "robot", textLoader, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});

describe("parseAssetManifest rebuilds the record (§96, 2026-09-11)", () => {
  it("returns a prototype-free copy so content keys cannot shadow Object.prototype", () => {
    const manifest = parseAssetManifest({
      constructor: { url: "a.png" },
      hasOwnProperty: { url: "b.png", hash: "x" },
      extra: { url: "c.png", ignored: true },
    });
    expect(Object.getPrototypeOf(manifest)).toBeNull();
    expect(manifest["constructor"]).toEqual({ url: "a.png" });
    expect(manifest["hasOwnProperty"]).toEqual({ url: "b.png", hash: "x" });
    expect(manifest["extra"]).toEqual({ url: "c.png" });
  });
});

describe("parseAssetManifest origin policy (§96, 2026-09-11)", () => {
  it("refuses scheme and protocol-relative URLs by default, keeps same-origin shapes", () => {
    expect(() =>
      parseAssetManifest({ a: { url: "https://cdn.example/a.png" } }),
    ).toThrow(/names another origin/);
    expect(() =>
      parseAssetManifest({ a: { url: "//cdn.example/a.png" } }),
    ).toThrow(/names another origin/);
    expect(parseAssetManifest({ a: { url: "/a.png" }, b: { url: "b/c.png" } })).toEqual(
      expect.objectContaining({ a: { url: "/a.png" }, b: { url: "b/c.png" } }),
    );
  });

  it("accepts other origins when opted in", () => {
    const manifest = parseAssetManifest(
      { a: { url: "https://cdn.example/a.png" } },
      "cdn",
      { allowCrossOriginUrls: true },
    );
    expect(manifest["a"]).toEqual({ url: "https://cdn.example/a.png" });
  });
});
