# Bounded PNG codec fixture

`squoosh-png-3.1.1.wasm` is the unmodified
`codec/pkg/squoosh_png_bg.wasm` from the npm package `@jsquash/png@3.1.1`.
SHA-256: `263d6e658808a74b72a1a99c5cc1d619237e70c150db6e41d5d84d3d117ab9be`.

Source and ABI glue: [jSquash PNG](https://github.com/jamsinclair/jSquash/tree/main/packages/png).
Upstream describes this as the Squoosh PNG codec, implemented in Rust with the
`png` crate. License: Apache-2.0, reproduced in `squoosh-png-LICENSE`.

This test fixture is not included in the published assets package (`files: [dist]`).
Production callers pin and supply the same executable module through
`BoundedPngDecoderOptions.wasmBinary`. The adapter uses its own small ABI bridge,
so independent decoder instances never share jSquash's mutable singleton module.

The tests generate their tiny PNG images directly from known pixels, PNG chunks,
CRC32, and zlib, then decode through this real codec. The Wasm ceiling is imposed
before instantiation; an allocator exhaustion test exercises the guest decoder.

`red.png` is an original, generated 1×1 RGBA8 opaque red PNG for the browser
regression. Its scanline bytes are `[0, 255, 0, 0, 255]` (filter 0 + RGBA).
