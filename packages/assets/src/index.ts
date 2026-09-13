/**
 * `@fourjs/assets` — the asset system (§76–78).
 *
 * Phase 11 (WP-11.2) ships the MVP tier: a deduplicating, reference-counted
 * {@link AssetManager} over an injectable `fetch`, plus text, JSON, binary, and
 * image loaders. The §77 texture tier landed 2026-08-21 (`texture.ts`), and the
 * §78 glTF 2.0 parse tier landed 2026-08-29 (`gltf.ts` — its module header
 * states the exact tier, the refusal list, and why assembly lives in `four`).
 *
 * §96's "asset loaders … shall treat external content as untrusted" is enforced
 * by the manager, not the loaders: an input-size limit
 * ({@link DEFAULT_MAXIMUM_BYTES}) and a whole-load deadline
 * ({@link DEFAULT_TIMEOUT_SECONDS}), both finite by default, both overridable
 * per manager. See `docs/guides/security-and-untrusted-content.md`.
 *
 * Content hashing (§76) and the §79 manifest landed on 2026-08-21, together
 * with the texture loader tier (§77's assets half): `load(url, loader, {
 * expectedHash })` refuses bytes that are not the bytes a manifest named, and
 * {@link createTextureLoader} turns encoded images into `TextureSource`-shaped
 * {@link TextureAsset}s under §96 decompression bounds. See `content-hash.ts`,
 * `manifest.ts`, and `texture.ts`.
 *
 * §76's cancellation landed on 2026-08-09: `load(url, loader, { signal })`
 * rejects and gives back its reference, and — when the manager was built with an
 * {@link AssetManagerOptions.abortController} — the last waiter's abort cancels
 * the request itself. The A-18 remainder (2026-09-06) adds progress
 * (`onProgress`), `stream()`, dependency graphs (`registerDependency` /
 * `loadGraph`), worker decoding (`decodeInWorker` + `workerFactory`), and
 * hot reload (`watch`). The rules are in `asset-manager.ts`'s module comment.
 */

export const PACKAGE_NAME = "@fourjs/assets";

// §81's asset-format token (RFC 0002): declared here; `@fourjs/four`'s
// `plugins.ts` re-exports the same object.
export { ASSET_LOADERS } from "./capabilities.js";
export type { RegisteredAssetLoader } from "./loader-registry.js";
export { AssetLoaderRegistry } from "./loader-registry.js";

export type {
  AbortHandle,
  AbortSignalLike,
  AssetGraph,
  AssetGraphLoadOptions,
  AssetLoadOptions,
  AssetLoader,
  AssetManagerOptions,
  AssetProgressEvent,
  AssetWatchLike,
  AssetWithDependencies,
  ByteReaderLike,
  FetchInit,
  FetchLike,
  FetchResponse,
  ReadableBodyLike,
  ResponseHeadersLike,
  TimerLike,
  WorkerLike,
} from "./asset-manager.js";
export {
  AssetManager,
  DEFAULT_MAXIMUM_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
} from "./asset-manager.js";
export type { DigestLike, TextDecodeLike } from "./content-hash.js";
export { CONTENT_HASH_ALGORITHM } from "./content-hash.js";
export type {
  AssetManifest,
  AssetManifestEntry,
  ManifestLoadOptions,
} from "./manifest.js";
export {
  loadFromManifest,
  manifestLoader,
  manifestUrl,
  parseAssetManifest,
} from "./manifest.js";
export type {
  DecodedTexels,
  TexelDecodeLike,
  TexelProbeLike,
  TextureColorSpace,
  TextureFilterMode,
  TextureLoaderOptions,
  TextureWrapMode,
} from "./texture.js";
export {
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
  TextureAsset,
  createTextureDecoder,
  createTextureLoader,
} from "./texture.js";
export type {
  GltfAnimationRecord,
  GltfChannelPath,
  GltfChannelRecord,
  GltfLoaderOptions,
  GltfMaterialRecord,
  GltfMeshRecord,
  GltfNodeRecord,
  GltfPrimitiveMode,
  GltfPrimitiveRecord,
  GltfSceneRecord,
  GltfSkinRecord,
} from "./gltf.js";
export { GltfAsset, createGltfLoader } from "./gltf.js";
export type {
  ImageBitmapLike,
  ImageDecodeLike,
  ImageLoaderOptions,
} from "./loaders.js";
export {
  ImageAsset,
  binaryLoader,
  createImageLoader,
  jsonLoader,
  textLoader,
} from "./loaders.js";

export { createGzipLoader } from "./gzip.js";
export type { GzipDecodeLike, GzipLoaderOptions, GzipReader } from "./gzip.js";
export { limitWasmMemory } from "./wasm-memory.js";
export {
  createBoundedPngDecoder,
  DEFAULT_IMAGE_WORKING_BYTES,
} from "./bounded-png.js";
export type { BoundedPngDecoderOptions } from "./bounded-png.js";
