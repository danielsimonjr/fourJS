# @fourjs/assets

Asset system. Part of [fourJS](../../README.md).

Implements the MVP tier of §76–78 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 11 (§113a).

## What's here

- **`AssetManager`** — deduplicating, reference-counted cache over an injectable `fetch` (`FetchLike`); concurrent requests for the same URL coalesce into one load, and releasing the last reference disposes the asset.
- **§96 untrusted-content limits** — `maximumBytes` (default `DEFAULT_MAXIMUM_BYTES`, 64 MiB) checked against the declared `content-length` _and_ against the body a loader reads, plus `timeoutSeconds` (default `DEFAULT_TIMEOUT_SECONDS`, 30 s) over transport and decode together, through an injectable `TimerLike`. Both finite by default; see [`docs/guides/security-and-untrusted-content.md`](../../docs/guides/security-and-untrusted-content.md).
- **Cancellation (§76)** — `load(url, loader, { signal })` takes any `AbortSignalLike` (the DOM's `AbortSignal` fits with no adapter). An aborted load rejects with `ASSET_LOAD_FAILED` / `context.reason === "aborted"` and hands back the reference it took, so it must not be released; a coalesced load survives one waiter's abort and is abandoned only when the last one goes; `release` is not `abort`. Pass `abortController: () => new AbortController()` to extend cancellation to the request itself (`canAbortTransport` reports whether it was), which also cancels a request that outran `timeoutSeconds`.
- **Progress (§76)** — `load(url, loader, { onProgress })` receives `{ loaded, total, url }`. `total` comes from `content-length` or `FetchResponse.contentLength` when the transport exposes one, otherwise `null`. Incremental events fire when `body.getReader` exists.
- **Streaming (§76)** — `assets.stream(url)` yields `Uint8Array` chunks from `body.getReader`, or the whole buffer once. A loader may also implement `loadStream(chunks, url)`.
- **Dependency graphs (§76)** — `registerDependency(parent, child)` plus `loadWithDependencies` (children first) and `loadGraph` (walks registered edges and `{ dependencies: string[] }` on a loader result). Cycles refuse with `context.reason === "dependency-cycle"`.
- **Worker decoding (§76)** — `load(..., { decodeInWorker: true })` posts the body to an injected `workerFactory` (`WorkerLike`); without one, decode stays in-process. Tests inject a fake — no real `Worker` is required. `canDecodeInWorker` reports the capability.
- **Hot reload (§76)** — `watch(url, listener)` forwards to an injected `watch: (url, cb) => unsub` (a dev-server file watcher). Without it, `watch` throws `INVALID_APPLICATION_STATE`. There is no built-in websocket protocol. `canWatch` reports the capability.
- **Content hashing (§76)** — `load(url, loader, { hashContent: true })` records a hash readable through `contentHash(url, loader)`; `{ expectedHash }` verifies it and **refuses** a mismatch (`context.reason === "hash-mismatch"`), which is the §96 integrity feature. SHA-256 over `crypto.subtle` by default, overridable through `digest`; `canHashContent` reports whether the runtime has one, and a hash that cannot be computed refuses rather than passes. See `src/content-hash.ts` for the algorithm argument.
- **The §79 manifest** — `manifestLoader` / `parseAssetManifest` (a manifest is untrusted content too), `loadFromManifest(assets, manifest, key, loader)` resolving logical key → URL → verified bytes, and `manifestUrl` for the matching `release`.
- **Loaders** — `textLoader`, `jsonLoader`, `binaryLoader`, `createImageLoader` (over an injectable `ImageDecodeLike`), and `createTextureLoader`; `AssetLoader` is the contract a custom loader implements.
- **`ImageAsset` / `TextureAsset`** — disposal wrappers (§83) around a decoded image and around decoded RGBA8 texels. `TextureAsset` is shaped as `@fourjs/render`'s `TextureSource` **structurally** (no dependency edge; `tests/integration/texture-manifest.test.ts` keeps the two spellings honest), carries §60a/§77 `colorSpace`/`filter`/`wrap`, and flips the codec's top-first rows so row 0 is `v = 0` (§7a).
- **§96 decompression limits** — `createTextureLoader` bounds decoded output (`maximumDecodedBytes`, default 64 MiB = 4096²) _and_ expansion ratio (`maximumExpansionRatio`, default 1000×), post-decode by default and pre-decode when an optional `probe` reads the header.

## Staged / not yet implemented

- The rest of the texture system (§77): cube/array/3D targets, mipmaps, anisotropy, compressed containers, render targets, video textures — all renderer-side (`R-30b`). What ships here is the loader tier that feeds it.
- The §76 record form `assets.load({ robot: "/models/robot.glb", … })` (loader inferred per extension).

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/assets`; publishes as `@danielsimonjr/fourjs-assets`.

## Bounded PNG decoding (§96)

`createBoundedPngDecoder({ wasmBinary, maximumWorkingBytes })` creates a PNG to
RGBA8 decoder with a Wasm heap ceiling set before initialization. Supply trusted
`codec/pkg/squoosh_png_bg.wasm` bytes from `@jsquash/png@3.1.1`; no runtime codec
fetch or singleton glue is used. Pass the returned function directly to
`createTextureLoader` or `createGltfLoader` with `maximumWorkingBytes` to require
that enforced cap. Ordinary native image callbacks fail that strict requirement.

Default PNG limits: 128 MiB linear heap, 64 MiB output, 1000× expansion. Native
heap limits do not include encoded input retained by the caller, host output
copies, row flipping, or total process memory. PNG CRC/framing and real allocator
failures are tested; APNG and other formats are refused. See the
[security guide](../../docs/guides/security-and-untrusted-content.md#image-decoder-heap-limits)
for complete accounting, trusted-code setup, native callback behavior, and CSP.
