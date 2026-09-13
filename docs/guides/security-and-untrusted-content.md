# Security and untrusted content

§96 opens with a single sentence that decides everything else in this guide:

> Asset loaders and scene deserializers shall treat external content as
> untrusted.

A scene file, a replay recording, and a downloaded asset all arrive from
somewhere the application does not control — a CDN, a user's disk, a bug
report, a URL someone pasted. This guide states what the engine does about
that, what it does **not** do, and the content-security-policy posture a
deployer can write their headers from.

## Honest state first

§96 lists seven requirements. The bounded PNG path enforces its codec heap
ceiling before initialization. Native image callbacks remain uncapped unless a
strict policy refuses them; output-size estimates alone cannot cap those heaps.
Texture decoding and raw gzip loading also have bounded output/expansion checks.
The aggregate decompression row remains **partial** on this branch because the
separate Draco/Basis implementation has not landed here.

| §96 requirement                                  | State                                                    | Where |
| ------------------------------------------------ | -------------------------------------------------------- | ----- |
| bounds checking                                  | **met**                                                  | `validateSceneDocument` / `validateReplayRecording` rebuild a document field by field and drop every key they do not know; geometry validates index ranges; base64 is canonical-only |
| no arbitrary code execution from scene files     | **met**                                                  | the formats are JSON; `cloneJsonValue` refuses a `__proto__` key; nothing anywhere in the engine calls `eval` or builds a `Function` from a string (see "CSP posture", which is tested) |
| input-size limits                                | **met**                                                  | `AssetManagerOptions.maximumBytes` for transport; `maximumTextLength` on `decodeSceneDocument` / `decodeReplayRecording` for documents — all three finite by default |
| cancellation and timeouts for expensive decoders | **met**                                                  | `AssetManagerOptions.timeoutSeconds` bounds a whole load, transport and decode together; `load(url, loader, { signal })` cancels one caller's load, and `AssetManagerOptions.abortController` extends both to the request itself (`canAbortTransport` reports whether a manager has it) |
| documented content-security-policy behavior      | **met**                                                  | this guide's "CSP posture" section, enforced by `tests/integration/security-csp.test.ts` |
| decompression limits                             | **partial overall; bounded PNG and gzip implemented**    | `createBoundedPngDecoder` caps the actual Wasm heap before initialization, checks PNG framing/checksums and output budgets, and refuses allocator failures. Image/texture/glTF `maximumWorkingBytes` rejects uncappable callbacks before loading. `createTextureLoader` and `createImageLoader` enforce finite decoded-byte and expansion-ratio limits, and `createGzipLoader` bounds streamed gzip output while cancelling on overflow. Separate Draco/Basis work has not landed on this branch, and native platform decoders still cannot be pre-bounded. |
| safe shader/plugin boundaries                    | **met**                                                  | the plugin half (2026-08-28, `A-3`/RFC 0002): a plugin is a **value** the application installs — `PluginHost.add` and `ApplicationOptions.plugins` accept no URL, no module specifier, and no name from a document, and `tests/integration/plugin-boundary.test.ts` fails if any deserializing package reaches the host. It is a boundary, **not a sandbox** — see "Plugins run with your authority". The shader half (2026-08-28, `R-14`/RFC 0001, spec revision 1.11): **shading is a graph of closed operators, never source text** — §60's shipped surface (`ShaderGraph`/`NodeMaterial`/`NodeMaterialBuilder`, `@fourjs/materials`) accepts no GLSL or WGSL anywhere, a graph is plain JSON whose every operator is a member of a closed union validated at construction (§85, with node and sampler caps), every texture it samples is enumerable (so §63's feedback/ordering checks still see a §70 graph effect's full sample set), and §57's `ShaderMaterial` — the name a source-string material would have had — is recorded **permanently unshipped**. An operator the engine has not implemented is a refused value, not an executed one |

Depth limiting is the sixth item's neighbour rather than one of the seven, and
it is met: both decoders bound JSON nesting. It matters more than its absence
from the list suggests — see "Deep documents are a denial of service", below.

## Assets: bytes and deadlines

`AssetManager` is the only thing in the engine that touches a network, so both
transport-side §96 limits live on it. Both defaults are **finite**; a limit
that defaults to `Infinity` is documentation, not a limit.

```ts
import { AssetManager, jsonLoader } from "fourJS/assets";

const assets = new AssetManager({
  maximumBytes: 8 * 1024 * 1024, // default: 64 MiB
  timeoutSeconds: 10, // default: 30 s — seconds, like every fourJS duration
});

try {
  const level = await assets.load("/levels/1.json", jsonLoader);
} catch (error) {
  // FourError, code "ASSET_LOAD_FAILED", context:
  //   { url, loader, limitName: "maximumBytes" | "timeoutSeconds",
  //     limit, observed? }
}
```

Two details are worth knowing because they change what an attacker can do:

- **The size limit is checked twice.** First against the response's declared
  `content-length`, before a single byte of body is read — an oversize download
  is refused while it is still a header. Then against what the body actually
  produced, because `content-length` is a claim by the same party that sent the
  bytes. The loader is handed a bounded view of the response whose
  `arrayBuffer()`, `text()`, and `json()` refuse an over-budget body rather
  than returning it, so a decoder never sees bytes the application declined.
  `text()` is measured in UTF-16 code units, which is never more than the UTF-8
  byte count — conservative in the safe direction.
- **The deadline covers decode, not just transport.** §96's phrase is
  "expensive decoders", and a decoder that never returns is exactly as fatal as
  a socket that never closes.

Either limit can be set to `Number.POSITIVE_INFINITY`, which is how an
application records in its own source that it has decided to trust an origin.

## Image decoder heap limits

Browser [`createImageBitmap`](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagebitmapoptions)
and [`ImageDecoder`](https://w3c.github.io/webcodecs/#dictdef-imagedecoderinit)
provide no configurable allocator maximum. Header probes, resize options,
workers, and deadline checks therefore cannot promise a native heap ceiling.

For static PNG textures, use the actual bounded decoder:

```ts
import {
  createBoundedPngDecoder,
  createTextureLoader,
  createGltfLoader,
} from "fourJS/assets";

// Application-pinned executable bytes from @jsquash/png@3.1.1:
// codec/pkg/squoosh_png_bg.wasm. Load them through your trusted module pipeline.
const maximumWorkingBytes = 32 * 1024 * 1024;
const decode = await createBoundedPngDecoder({
  wasmBinary: trustedPngWasmBytes,
  maximumWorkingBytes,
  maximumDecodedBytes: 8 * 1024 * 1024,
  maximumExpansionRatio: 1000,
});
const pngLoader = createTextureLoader({
  decode,
  maximumWorkingBytes,
  colorSpace: "srgb",
});
const gltfLoader = createGltfLoader({
  decodeTexture: decode,
  maximumWorkingBytes,
});
```

The pinned binary's SHA-256 is
`263d6e658808a74b72a1a99c5cc1d619237e70c150db6e41d5d84d3d117ab9be`.
The application supplies trusted codec code; asset contents cannot select code or
module URLs. This factory owns its Wasm instance and its ABI bridge, with no
jSquash singleton JavaScript glue or new runtime dependency. It validates PNG
chunk framing and CRCs before invoking the codec. APNG is refused. Standard PNG
color types, palettes, transparency, row filters, and 16-bit-to-RGBA8 conversion
are tested with the real codec.

`maximumWorkingBytes` defaults to 128 MiB in the PNG factory and cannot be disabled.
It is a safe integer from 64 KiB through 4 GiB, rounded down to Wasm's 64 KiB pages;
a budget below the binary's initial heap is refused. The cap is set before
instantiation, so even startup code and guest `memory.grow` cannot exceed it.
The decoder reuses its heap across successful synchronous calls. A codec trap or
exception permanently refuses further calls on that instance; construct a fresh
one to recover. Header/budget failures before codec execution leave it usable.

Each decode has one bounded native heap plus at most one independently bounded
RGBA8 host copy. The caller's encoded buffer, already bounded by `AssetManager`,
lives outside the codec. Default texture row flipping temporarily needs another
RGBA8 buffer; returned assets and multiple decoder instances are separate
allocations. A 32 MiB heap and 8 MiB output limit consequently allow up to 48 MiB
of codec heap and RGBA buffers during a flip, plus encoded input and runtime
bookkeeping. These numbers describe live buffers, **not peak process RSS** or
when the garbage collector returns memory to the OS.

On image, texture, and glTF factories, `maximumWorkingBytes` is an opt-in strict
requirement. It checks a private factory-established capability before transport
or decode, rejects an insufficient cap, and rejects ordinary native callbacks.
Pass the bounded function directly: wrapping it in another callback loses that
capability. `createImageLoader` has no bounded native bitmap producer; its strict
option fails closed, and the PNG texture path is the supported alternative.
JPEG, WebP, and AVIF currently have no bounded adapter in this package, so a PNG
adapter rejects them rather than falling back to a native decoder.

Without this option, existing native callbacks remain available. Image loaders
now check a 64 MiB RGBA8-size estimate and 1000× expansion by default, and close
rejected bitmaps. These estimates are not actual native allocation measurements.
Texture loaders additionally check a returned view's full backing buffer.
Both preserve the original encoded size even if a worker transfers the input.
`requireProbe` can refuse unknown formats before native decoding, but a successful
probe is still not proof of bounded native memory.

Decoding remains synchronous inside Wasm; use an appropriately managed worker
when cancellation must interrupt computation. Neither this heap limit nor an
`AssetManager` deadline preempts a blocked JavaScript thread. WebAssembly use may
require `script-src 'wasm-unsafe-eval'` under a strict CSP, without permitting
JavaScript `unsafe-eval`.

## Documents: length and depth

```ts
import { decodeSceneDocument } from "fourJS/serialization";
import { decodeReplayRecording } from "fourJS/diagnostics";

const scene = decodeSceneDocument(text, {
  maximumTextLength: 1_000_000, // default: 33_554_432 UTF-16 code units
  maximumDepth: 64, // default: 1024 nesting levels
});

const recording = decodeReplayRecording(replayText);
```

A refused document raises `FourError` with code `UNTRUSTED_INPUT_REJECTED` and
a `context` naming the `limitName`, its `limit`, and the `observed`
measurement — so a host can log which policy fired without parsing a message.
That code is deliberately distinct from the `TypeError`s the validators throw
for a malformed field: those say "this is not a scene", this says "this is not
something we are willing to look at".

The two `validate*` entry points (`validateSceneDocument`,
`validateReplayRecording`) are **not** guarded, and that is deliberate: they
take a value the caller already built or vouched for — `ReplayRecorder.finish`
and `ReplayPlayer.load` both go through them — and bounding an in-memory object
the process just produced would refuse nothing an attacker controls. The guard
belongs at the text boundary, which is where the untrusted content is.

### Deep documents are a denial of service

`JSON.parse` is not the vulnerable step. V8 parses a hundred thousand levels of
`[[[[…]]]]` without complaint. The vulnerable step is the engine's own:
`validateSceneDocument` recurses once per `children` generation,
`cloneJsonValue` once per level of a metadata payload. A few kilobytes of
nested brackets therefore buys a `RangeError: Maximum call stack size exceeded`
thrown from deep inside a validator, on a stack too short to say what happened,
in a host that shares that stack with everything else on the page.

So the depth check runs before any recursive consumer sees the value, and the
check is itself **iterative** — breadth-first, one level at a time. A recursive
depth checker would be the same defect wearing the guard's name: it would
overflow on precisely the input it exists to refuse.

The default of 1024 levels admits a node subtree roughly 500 generations deep
(a §79 node costs two JSON levels per generation), which is far past any
authored scene and far short of the recursion depth at which a validator dies.

## CSP posture

fourJS is designed to run under a strict Content-Security-Policy with **no
`'unsafe-eval'` and no `'unsafe-inline'`**. Concretely, no package in this
repository:

- calls `eval`, or builds a function from a string (`new Function`, or a
  string argument to `setTimeout` / `setInterval`) — so `script-src` needs no
  `'unsafe-eval'`;
- writes markup into the document (`innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`) or assigns a raw `style.cssText` — so
  neither `script-src` nor `style-src` needs `'unsafe-inline'`;
- injects a `<script>` or `<style>` element of its own. The renderer draws into
  a canvas the application supplies; `@fourjs/ui` is a scene-graph widget tier
  that renders through that same canvas, not a DOM component library.

A workable starting policy for an application built on fourJS:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data: blob:;
  connect-src 'self' https://your-asset-origin.example;
  worker-src 'self' blob:;
```

Widen `connect-src` to the origins `AssetManager` fetches from, and `img-src`
to wherever textures come from. `worker-src 'self' blob:` is there for §88's
staged worker modes; drop it until you use one.

**This section is tested, not merely asserted.**
`tests/integration/security-csp.test.ts` greps every `packages/*/src` file and
every example for those constructs and fails if one appears. A package that
genuinely needs one does not silence the test — it changes this guide first,
because this guide is the document a deployer's policy is written from.

Two related deployment headers are covered elsewhere: WebGPU and shared-memory
worker modes need COOP/COEP, which
[Workers and cross-origin isolation](workers-and-cross-origin-isolation.md)
explains.

## Plugins run with your authority

§81's plugin system landed on 2026-08-28 (`A-3`, RFC 0002), and §96's _"safe
plugin boundaries"_ is the requirement it had to answer. The honest answer has
two halves, and only one of them is good news.

**There is no sandbox, and none is claimed.** A plugin is JavaScript your
application imported. It runs with your authority: your network, your DOM, your
globals. Isolation would mean Workers or realms plus a serialisable message
boundary for every registry a plugin registers into, which is a project in
itself rather than a flag. Install a plugin exactly as carefully as you would
add any other dependency.

**What is enforced is how a plugin can arrive.** A plugin is a _value_:

```ts
import { gridPlugin } from "@vendor/grid"; // your import, your module graph

const app = new Application({ plugins: [gridPlugin] });
await app.initialize();
```

`PluginHost.add` and `ApplicationOptions.plugins` take a `FourPlugin` object.
They take no URL, no module specifier, and no name — so there is no expression
in this API that turns a _string_ into running code, which means no
deserialization path can reach it. A scene document names a **registered type
name** (§79); a name it has not registered gets the existing error, not a load.
Plugins named in a scene file (`"plugins": ["@vendor/thing"]`) were considered
and rejected outright rather than staged, because that is arbitrary code
execution from a scene file in the plainest possible form.

Both halves are checked, not asserted: `tests/integration/plugin-boundary.test.ts`
fails if any source file under `@fourjs/serialization` or `@fourjs/assets` so much
as mentions the plugin host, and pins the fact that `add`'s parameter type
admits no string.

## What is not covered

Being explicit about the holes is the point of the honest-state table; these
are the ones that most affect how you deploy:

1. **Native platform heaps and total process memory.** The bounded PNG adapter
   limits its Wasm linear heap, including input, temporary allocations, and native
   output. It separately checks the host RGBA copy before allocation. It cannot cap
   browser/OS bookkeeping, Wasm compilation, other decoder instances, retained
   assets, or an arbitrary native decoder. Texture and gzip output bounds do not cap
   their host decoder's internal memory. The separate Draco/Basis work is outside
   this branch.
2. **Shader boundaries left this list on 2026-08-28 (`R-14`/RFC 0001).** There
   is no path by which a scene file — or anything else — can name shader
   source, and spec revision 1.11 makes that permanent: shading is a graph of
   closed operators (§60), validated at construction, and §57's
   `ShaderMaterial` row is recorded permanently unshipped. What was settled is
   the _arrival_ rule, exactly as with plugins: a document can carry a
   picture (a graph), never a program (source text). A data-declared
   custom operator now lowers through `ShaderFunction` into the same validated
   closed union (2026-09-11); no source-code execution is introduced.

   (The **plugin** half of this item left the list the same day with `A-3`.
   See "Plugins run with your authority" for what was actually settled — a
   boundary on how a plugin can arrive, not isolation once it has.)

(Transport-level cancellation left this list on 2026-08-09: `load(url, loader,
{ signal })` cancels a caller's load, and `AssetManagerOptions.abortController`
aborts the underlying request — for the `timeoutSeconds` deadline too. A decode
that has already begun still runs to its end — no signal reaches inside a
loader — but its result is discarded and its cache slot freed.)

Beyond §96's list, two ordinary web-application responsibilities remain the
application's, not the engine's: fourJS never validates that a URL points
somewhere you meant (do that before calling `load`), and it never sets response
headers — `Content-Type`, `X-Content-Type-Options: nosniff`, and CORS policy
are your server's.

## Raw gzip assets

```ts
import { createGzipLoader } from "fourJS/assets";

const gzip = createGzipLoader(
  (bytes) =>
    new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader(),
  { maximumDecodedBytes: 64 * 1024 * 1024, maximumExpansionRatio: 1000 },
);
const bytes = await assets.load("/scene.json.gz", gzip);
```

The limits are finite and positive. The loader validates the header, checks each
chunk before copying it, cancels on overflow, and releases the reader. It publishes
bytes only after stream completion, so a checksum failure never returns a partial
asset. The host decoder must validate the gzip checksum and trailer, as required by
the [Compression Standard](https://compression.spec.whatwg.org/#gzip).

This is raw file decompression; do not apply it to HTTP `Content-Encoding: gzip`
responses already decoded by fetch. `AssetManager` bounds the encoded body and the
load deadline. Its deadline rejects the load; it does not preempt host decoder CPU
work. Output buffer growth and the final trimmed copy retain at most twice the
configured decoded limit, plus encoded input and host-owned decoder buffers.
