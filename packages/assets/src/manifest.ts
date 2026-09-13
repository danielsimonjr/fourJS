/**
 * The §79 asset manifest — logical key → URL + content hash.
 *
 * §79's identity clause is exact: *"assets are referenced by logical key,
 * resolved through a manifest that maps each key to a URL and content hash
 * (§76)"*. This module is that map and the one operation it exists for —
 * resolving a key into a verified load:
 *
 * ```ts
 * const manifest = await assets.load("/assets.json", manifestLoader);
 * const robot = await loadFromManifest(assets, manifest, "robot", binaryLoader);
 * // …fetches manifest.robot.url and refuses bytes whose hash is not
 * // manifest.robot.hash (§96).
 * ```
 *
 * ## Why it lives here and not in `@fourjs/four`
 *
 * A manifest is an *asset-manager* concept: it resolves keys to URLs and hands
 * the hash to the verification path in `asset-manager.ts`. What `@fourjs/four`'s
 * scene serializers need (A-16) is the other end — a `SceneResourceCatalog`
 * whose `get(key)` answers a **already-loaded** `BufferGeometry` or `Material`,
 * synchronously, because deserialization is synchronous. So the wiring is
 * necessarily two steps: preload every key a document names through the
 * manifest, then hand the resulting map to `resourceCatalog(...)`. Step one is
 * this module; step two is `preloadManifestIntoCatalog` on the umbrella,
 * because that is the half that knows what a geometry or a material *is* and
 * because `get(key)` must stay synchronous. Naming the seam is the point of
 * this paragraph: nothing about §79's manifest is blocked on hashing any more.
 *
 * ## A manifest is untrusted content (§96)
 *
 * It arrives over the same network as everything else, so {@link
 * parseAssetManifest} validates its shape and refuses anything else, rather than
 * casting a parsed `unknown` and discovering the problem as a `TypeError` three
 * frames later. Note what it deliberately does **not** do: it does not check
 * that the URLs are same-origin, absolute, or otherwise safe. That is the
 * application's policy — it is the party that knows its own origins — and a
 * library that guessed would either block legitimate CDNs or imply a guarantee
 * it cannot keep.
 */

import { FourError } from "@fourjs/core";

import type { AssetLoader, AssetLoadOptions } from "./asset-manager.js";
import { AssetManager } from "./asset-manager.js";

/** One manifest row: where an asset lives, and what its bytes must hash to. */
export interface AssetManifestEntry {
  /** The URL the asset is fetched from (§79). */
  readonly url: string;
  /**
   * The content hash the bytes must have (§76's format:
   * `"sha256-<hex>"` for the built-in digest).
   *
   * Optional, because a development manifest produced before a build step
   * genuinely has none — and an *absent* hash means "not verified", which is a
   * different statement from a hash that does not match. {@link
   * loadFromManifest} carries that distinction through:
   * {@link ManifestLoadOptions.requireHash} is how an application says its
   * manifest must be the verified kind.
   */
  readonly hash?: string;
}

/** §79's map from logical key to {@link AssetManifestEntry}. */
export type AssetManifest = Readonly<Record<string, AssetManifestEntry>>;

/** Options for {@link loadFromManifest}, over {@link AssetLoadOptions}. */
export interface ManifestLoadOptions extends AssetLoadOptions {
  /**
   * Refuse a manifest row that declares no `hash` (§96). Defaults to `false`.
   *
   * `true` is the production posture: it turns "this manifest was built without
   * hashes" from a silent loss of verification into a load-time failure.
   */
  readonly requireHash?: boolean;
}

/** Refuses a malformed manifest, naming the offending key (§96, §85). */
function refuse(message: string, context: Record<string, unknown>): FourError {
  return new FourError("ASSET_LOAD_FAILED", message, { context });
}

/**
 * Validates a parsed JSON document as an {@link AssetManifest} (§79, §96).
 *
 * @param document - The parsed document, e.g. from `jsonLoader`.
 * @param source - A label used in failure messages (a URL, typically).
 * @returns The same object, typed.
 * @throws FourError `ASSET_LOAD_FAILED` if it is not an object of
 *   `{ url: string, hash?: string }` rows.
 */
/** Options for {@link parseAssetManifest} (2026-09-11). */
export interface ManifestParseOptions {
  /**
   * Whether an entry may name another origin — a `scheme:` URL or a
   * protocol-relative `//host/…` one. Defaults to `false`: a manifest is a
   * fetched document (§96), and one that can point a key at any origin can
   * direct every later `assets.load` there. Same-origin shapes (`/path`,
   * `relative/path`) are always accepted. Set `true` for a trusted CDN layout,
   * as `createGltfLoader({ allowAbsoluteUris: true })` does for glTF.
   */
  readonly allowCrossOriginUrls?: boolean;
}

/** `scheme:` or `//host` — anything that names an origin. */
function namesAnotherOrigin(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith("//");
}

export function parseAssetManifest(
  document: unknown,
  source = "manifest",
  options: ManifestParseOptions = {},
): AssetManifest {
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    throw refuse(
      `"${source}" is not a §79 asset manifest: expected an object of ` +
        `key → { url, hash? } entries.`,
      { source },
    );
  }
  // Rebuilt rather than returned: a parsed document is content (§96), and the
  // copy has no prototype, so a key such as "constructor" or "hasOwnProperty"
  // is an ordinary entry and nothing else.
  const manifest = Object.create(null) as Record<
    string,
    { url: string; hash?: string }
  >;
  for (const [key, entry] of Object.entries(document)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw refuse(
        `"${source}" entry ${JSON.stringify(key)} is not an object with a url.`,
        { source, key },
      );
    }
    const { url, hash } = entry as { url?: unknown; hash?: unknown };
    if (typeof url !== "string" || url === "") {
      throw refuse(
        `"${source}" entry ${JSON.stringify(key)} has no url (§79).`,
        { source, key },
      );
    }
    if (!(options.allowCrossOriginUrls ?? false) && namesAnotherOrigin(url)) {
      throw refuse(
        `"${source}" entry ${JSON.stringify(key)} names another origin ` +
          `(${JSON.stringify(url)}); only same-origin URLs are accepted ` +
          `unless parsed with { allowCrossOriginUrls: true } (§96).`,
        { source, key, url },
      );
    }
    if (hash !== undefined && typeof hash !== "string") {
      throw refuse(
        `"${source}" entry ${JSON.stringify(key)} has a non-string hash (§79).`,
        { source, key },
      );
    }
    manifest[key] = hash === undefined ? { url } : { url, hash };
  }
  return manifest;
}

/**
 * Loads a manifest document (§79) — `jsonLoader` plus {@link
 * parseAssetManifest}, so a malformed manifest fails at the fetch that read it
 * rather than at the first key someone resolves.
 */
export const manifestLoader: AssetLoader<AssetManifest> = {
  name: "manifest",
  async load(response, url): Promise<AssetManifest> {
    return parseAssetManifest(await response.json(), url);
  },
};

/**
 * Resolves a logical key through a manifest and loads it, verified (§79).
 *
 * The whole point of the indirection: the caller names `"robot"`, the manifest
 * says which URL that is *and* what its bytes must hash to, and the manager
 * refuses anything else (§96). A reference is taken exactly as
 * {@link AssetManager.load} takes one — release it with the *manifest's* URL,
 * which {@link manifestUrl} answers.
 *
 * @throws FourError `ASSET_LOAD_FAILED` if the key is not in the manifest, if
 *   {@link ManifestLoadOptions.requireHash} is set and the row has no hash, or
 *   (asynchronously) for any reason `load` rejects — a hash mismatch included.
 */
export function loadFromManifest<T>(
  assets: AssetManager,
  manifest: AssetManifest,
  key: string,
  loader: AssetLoader<T>,
  options?: ManifestLoadOptions,
): Promise<T> {
  const entry = manifest[key];
  if (entry === undefined) {
    throw refuse(
      `The asset manifest names no key ${JSON.stringify(key)} (§79).`,
      { key, loader: loader.name },
    );
  }
  if (options?.requireHash === true && entry.hash === undefined) {
    throw refuse(
      `Manifest key ${JSON.stringify(key)} declares no content hash, and ` +
        `requireHash was set (§79, §96).`,
      { key, url: entry.url, loader: loader.name },
    );
  }
  return assets.load(entry.url, loader, {
    signal: options?.signal,
    hashContent: options?.hashContent,
    expectedHash: entry.hash,
  });
}

/**
 * The URL a manifest key resolves to, for the `release` that pairs with a
 * {@link loadFromManifest} — the manager is keyed by URL, and a caller that
 * only ever saw the logical key would otherwise have to reach into the
 * manifest itself.
 *
 * @returns The URL, or `undefined` when the manifest does not name the key.
 */
export function manifestUrl(
  manifest: AssetManifest,
  key: string,
): string | undefined {
  return manifest[key]?.url;
}
