# RFC 0008: §56 full text shaping engine (HarfBuzz-wasm vs native)

- **Status:** accepted 2026-09-11 — implementation requested by the owner; recommendations adopted.
- **Date:** 2026-09-06
- **Owner decision:** 2026-09-11: implement all RFCs and remaining TODO items.
- **Spec sections affected:** §56 (primary), §33, §49, §73, §76, §79, §83, §85, §86, §89, §90, §91, §96, §98

## Context

§56 stages full shaping, bidirectional layout, and ligatures behind a
**shaping-engine decision** — "for example HarfBuzz via WebAssembly versus a
native implementation" — "to be recorded by amendment before that work
begins." `TODO.md` repeats the gate: "Before §56 full text shaping: RFC the
shaping engine." AUDIT-120 **S-6** and MEMORY (2026-07-29, Phase −1) both name
HarfBuzz-wasm as the likely route. This RFC is that decision.

Verified against the tree (2026-09-06):

- `@fourjs/text` is the §56 MVP tier: a built-in 6×12 monospace ASCII face,
  `buildGlyphAtlas`, and `layoutText`. It **produces data, never nodes**. Its
  frozen §3.1 row is `core, math, geometry`.
- `layoutText` is a pen walk: one atlas glyph per **code point** (a
  `for…of` walk over the string, so a surrogate pair is one lookup, which
  falls to the atlas `fallback` glyph), explicit `\n` only, no wrapping,
  no bidi, no ligatures, no kerning. Alignment is
  post-walk. The module header lists shaping as staged on this RFC.
- The `Text` node lives in the umbrella `four` (R-28): one geometry over one
  atlas material. It consumes `layoutText`'s quads. It does not shape.
- `@fourjs/ui` `Label` measures through the same layout. Text _input_
  (selection, caret, clusters) is still blocked on a real shaper (S-6).
- RFC 0004 alternative C was rejected in part because an engine `fillText`
  would pre-empt this decision. That rejection still holds.

Two things §56 names that this RFC does **not** decide:

- **SDF / MSDF rendering.** S-6 separates it: the atlas is coverage bitmaps
  today; crisp scale is a rasterisation problem, not a shaping problem. A
  shaper that emits glyph ids works with bitmap, SDF, or MSDF atlases.
- **Line breaking (UAX #14).** `text-layout.ts` already says wrapping is a
  different packet — it decides where lines _end_, not how a run is shaped.
  A shaper must expose cluster and break-opportunity data so wrapping can
  land later without a second engine choice.

The decision is forced now because every further §56 row (bidi, ligatures,
kerning, rich spans, caret, text-on-path that follows clusters) is a
consumer of one shaping ABI. Picking the engine after those packets would
rewrite them.

## Proposed decision

### 1. HarfBuzz via WebAssembly is the full-shaping engine

The engine for §56's non-MVP rows — complex scripts, OpenType GSUB/GPOS,
ligatures, mark positioning, Arabic/Indic reordering in concert with a bidi
pass — is **HarfBuzz compiled to WebAssembly**, loaded as an **optional**
adapter. It is not compiled into `@fourjs/text`'s default graph and it is not
a §3.1 dependency of `text`, `ui`, or `four`.

Reasons, against the native alternative argued in § Alternatives:

- HarfBuzz is the industry shaper (Chrome, Firefox, FreeType stacks,
  rustybuzz). A first-party "native" shaper that claimed §56 completeness
  would be a multi-year Unicode project the repository is not staffed to
  own.
- WASM is the only form that runs in the browser _and_ in the headless
  Node/Bun suites without a native addon. A `.node` HarfBuzz binding would
  split the matrix (browser vs CI) and fail the "engine runs without DOM"
  rule `@fourjs/text` already keeps.
- Same WASM module + same font bytes + same script/language/features is
  **same-runtime deterministic** (§33). Host-OS text APIs are not.

"Native" in this RFC means a first-party TypeScript shaper _or_ a
host-OS/ICU binding. Both lose for full §56. A small first-party path
remains as the **default identity shaper** (today's 1:1 code-point walk) so
the MVP tier and the §86 payload budget do not move.

### 2. The seam is a `ShapingEngine` in `@fourjs/text`

```ts
export interface ShapedGlyph {
  /** Atlas / font glyph id. */
  readonly glyphId: number;
  /** Cluster index into the original string (caret / selection). */
  readonly cluster: number;
  /** Advance in font units (em-relative). */
  readonly advanceX: number;
  readonly advanceY: number;
  /** Offset from the current pen, font units. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ShapedRun {
  readonly glyphs: readonly ShapedGlyph[];
  readonly script: string;
  readonly direction: "ltr" | "rtl" | "ttb" | "btt";
}

export interface ShapeQuery {
  readonly text: string;
  readonly fontId: string;
  readonly script?: string;
  readonly language?: string;
  readonly direction?: "ltr" | "rtl" | "ttb" | "btt";
  /** OpenType feature tags, e.g. `{ liga: 1, kern: 1 }`. */
  readonly features?: Readonly<Record<string, number>>;
}

export interface ShapingEngine extends Disposable {
  readonly name: string;
  readonly version: string;
  /**
   * Load font bytes. Returns a `fontId` the engine minted (monotonic,
   * never a clock — §33). Refuses over `maximumFontBytes` with
   * `UNTRUSTED_INPUT_REJECTED` (§96).
   */
  addFont(bytes: Uint8Array, options?: { maximumFontBytes?: number }): string;
  removeFont(fontId: string): void;
  shape(query: ShapeQuery): readonly ShapedRun[];
}
```

Placement: `packages/text/src/shaping.ts`. No new package. `layoutText`'s
signature is `layoutText(text, atlas, options)`, so the hook is a new
optional field on `TextLayoutOptions` — `shaper?: ShapingEngine` (with
`fontId`, `script`, `language`, `direction`, `features` passed through as
optional siblings) — rather than a fourth positional argument; omitted, the
function keeps today's identity walk **bit-identical**. That is the R-28 alignment
precedent (the `"left"` path does not run the shift loop).

The WASM adapter (`HarfBuzzShapingEngine`) lives in the same package as a
**separate entry** — `@fourjs/text/harfbuzz`, surfaced by the umbrella as
`fourJS/text/harfbuzz` (the umbrella's `package.json` name is `fourJS`;
`four` is only the workspace nickname the plan and the spec use), or a
dynamic import — so a consumer that never names it does not download the
wasm. If the wasm blob
cannot legally sit inside `@fourjs/text` without dragging every importer
(bundler / `exports` map), the packet splits it into a workspace package
**only after** an owner amendment to §98. The default recommendation is
the extra `exports` entry, not a 25th package.

### 3. Bidi is in the adapter, not a second engine

Full §56 requires UAX #9 before HarfBuzz sees each run. The
HarfBuzz-wasm adapter owns that pass (the usual
unicode-bidi / rustybuzz-pre-process pair, compiled into the same wasm or
as a second small wasm loaded with it). Application code does not pick a
separate bidi library. The identity shaper does not run bidi — ASCII MVP
text is LTR, as today.

Vertical directions (`ttb` / `btt`) are declared on the interface so a
later packet can fill them; the first HarfBuzz packet refuses them with
`FourError` **`NOT_IMPLEMENTED`** — the code `packages/core/src/errors.ts`
already reserves for "a named part of the public API exists but its
behaviour lands in a later phase" — rather than invent a vertical layout
or a new code. (`FourErrorCode` is an open union kept in that one file;
§89's list is examples, per revision 1.13. No `UNSUPPORTED_TEXT_FEATURE`
is added by this RFC.)

### 4. Fonts are untrusted bytes

`addFont` is the §96 boundary. Font files are decoded content: finite
`maximumFontBytes` (recommendation: **16 MiB** default, A-23's "a limit
defaulting to `Infinity` is documentation"), no `eval`, no native code.
A malformed table is `UNTRUSTED_INPUT_REJECTED`, not a throw from inside
wasm that escapes as an opaque trap — the adapter catches wasm faults and
re-throws `FourError`. A-23's split applies to the two inputs: the font
_bytes_ are content, so bytes over `maximumFontBytes` are also
`UNTRUSTED_INPUT_REJECTED`; the _option_ is application-built, so a
non-finite or non-positive `maximumFontBytes` is a `RangeError` (§85), the
same pair `CanvasTexture`'s `maximumBytes` validation draws.

`@fourjs/assets` may grow a font loader later; this RFC does not add one.
The shaper accepts bytes the application already has. No URL parameter
(RFC 0002 / RFC 0004: a function or a buffer, never a specifier).

### 5. Determinism

Shaping is **in** the §33 envelope when — and only when — the engine,
the wasm build id, the font bytes, and the query are fixed. The packet
pins a wasm build (hash in the adapter) and a golden: known font +
`"fi"` + `liga` → one ligature glyph, bit-identical clusters and
advances.

Host measurement (`measureText`, `Intl.Segmenter` as the _engine_) is
rejected as a shaper: segmenter locale data and font rasterisation differ
by platform. `Intl.Segmenter` MAY be used later for UAX #14 wrapping as
an _optional_ host hint, with a first-party fallback; that is the
wrapping packet, not this one.

Shaped advances are **font units**, converted to world units by
`layoutText` using the same `size / lineHeight` scale the MVP already
defines. Conversion is deterministic arithmetic in `@fourjs/text`.

Painted or host-rasterised glyph _images_ remain display content (RFC
0004's rule). Glyph **metrics** from HarfBuzz are not: they are a pure
function of bytes. Atlas rasterisation (FreeType, msdfgen, the built-in
bitmap) is a later/other packet and stays out of checksums if it is
host-dependent; the layout quads from HarfBuzz advances may be
checksummed.

### 6. Payload and tree-shaking

§86's minimal 2D app is `core + math + scene + render-webgl` ≤ 150 kB
gzip and does not include `@fourjs/text`. The real risk is **ui-demo** and
any example that imports `four/text`. The identity path must remain the
default export; the wasm must be absent from every bundle that does not
name `HarfBuzzShapingEngine` or `fourJS/text/harfbuzz`.

Published HarfBuzz-wasm builds are several hundred kilobytes raw and
roughly 100–200 kB gzip (an estimate from published `harfbuzzjs` builds —
the packet measures the pinned build and records the number; nothing
here depends on the estimate). That is acceptable as an **opt-in** and
forbidden as a default. The
packet's A/B measurement (below) is a gate, not a hope.

### 7. What `layoutText` and `Text` gain

- Optional shaped runs → quads (clusters preserved on `TextQuad` so
  caret/selection can land).
- RTL runs reverse the pen walk per run, not per string.
- Ligatures occupy one quad and a cluster range.
- Bit-identical output when no shaper is passed.
- **Glyph id → quad.** Today's `GlyphAtlas.glyphs` is keyed by character,
  which a shaper's glyph ids cannot index. `GlyphAtlas` gains an optional
  `glyphsById: ReadonlyMap<number, GlyphAtlasEntry>`; `buildGlyphAtlas`
  fills it for the built-in face with **code point as glyph id** (which is
  exactly the identity shaper's id space), and a shaped glyph whose id is
  absent falls to `atlas.fallback`, as an unknown character does today. An
  application shaping with HarfBuzz supplies an atlas whose `glyphsById`
  was rasterised outside the engine (display content, RFC 0004's rule);
  engine-side rasterisation of arbitrary fonts stays the deferred SDF /
  bitmap packet. The first packet's goldens therefore check ids,
  clusters, advances and quad geometry — never glyph images.

The `Text` node and `Label` do not import the wasm. They accept layout
output. An application that wants Arabic constructs a
`HarfBuzzShapingEngine`, `addFont`s, and passes the shaper into layout.

### 8. Staging

**Decision this RFC records (no code).** After acceptance, the first
packet is: `ShapingEngine` + identity default + `layoutText` option +
cluster field on `TextQuad` (additive, default unused) + the wasm
adapter behind a separate export + one Latin-ligature golden + the
§96 font-byte limit + A/B bundle proof.

**Deferred:** SDF/MSDF; vertical writing; colour
fonts (COLR/CPAL); variable-font axis animation; a §79 font resource;
`@fourjs/assets` font loader; a 25th package. Line wrapping (`wrapWidth`,
UAX #14-lite) shipped 2026-10-05 as a follow-on packet on the identity and
HarfBuzz layout paths.

## Alternatives

**A. First-party "native" TypeScript shaper.** A Latin kerning table and
a hard-coded `fi` ligature could ship small. It loses the moment §56's
list is read honestly: Arabic, Devanagari, Hebrew, Thai, emoji ZWJ,
mark-to-base — each is a specialist problem HarfBuzz already solved.
Owning a partial shaper that applications will treat as complete is
worse than staging. A first-party path **already exists**: the identity
shaper. That is the native implementation this RFC keeps, and it is
explicitly _not_ the full engine.

**B. Host-OS / browser shaping (`measureText`, `Intl`, CoreText,
Uniscribe, DirectWrite).** Nicest visual match to the platform. Rejected:
not same-runtime portable, not available in the headless suites without
a DOM or a native addon, and `@fourjs/text`'s public surface names no
DOM type (RFC 0004's DOM-free seam rule; the workspace tsconfigs do not
pin `lib`, so this is a rule the seam keeps, not a compiler guarantee).
RFC 0004 already refused a DOM-typed paint seam for this reason.

**C. rustybuzz (Rust → wasm) instead of HarfBuzz C → wasm.** rustybuzz
is a HarfBuzz subset/port. It is an implementation detail of the
adapter, not a second engine. The packet may pick either wasm _build_
so long as the ABI above is stable and the build is pinned. This RFC
does not freeze the crate vs `harfbuzzjs` vs a custom build; it freezes
**HarfBuzz-compatible shaping** behind `ShapingEngine`.

**D. Make HarfBuzz a hard dependency of `@fourjs/text`.** Simplest import.
It blows the payload budget for every UI label in existence and pulls
wasm init onto the critical path of the bitmap tier. Rejected.

**E. New `@fourjs/text-harfbuzz` package now.** Cleaner graph, but it is a
25th directory not in §98. Rejected until the owner amends the monorepo
tree. The `exports` map (or a later amendment) is the escape hatch.

**F. Delay until SDF lands.** Shaping and SDF are independent (S-6).
Waiting couples a metrics problem to a filtering problem and keeps
caret/bidi blocked for no reason.

## Consequences

**Easier.** A single ABI unblocks bidi, ligatures, kerning, caret
clusters, and (later) wrapping. Applications that only need ASCII keep
the current path with no wasm and no API break. The specification's
"record by amendment" gate becomes a concrete choice.

**Harder.** The project takes a wasm lifecycle (init, fail, version
pin, fault isolation) in a package that today is pure arithmetic.
Font-byte limits and untrusted-table handling become standing §96
surface. Contributors will want to "just import HarfBuzz" from `Label`;
the optional-entry rule will need repeating, the way RFC 0004 repeats
"no `fillRect`".

**Committed to.** Full §56 shaping is HarfBuzz-compatible WASM, optional.
The default engine remains the identity pen walk. `@fourjs/text` stays
data-only and DOM-free. Font bytes are untrusted. No new §98 package
in this RFC. SDF and wrapping stay separate packets.

## Compatibility analysis

Rows in `docs/COMPATIBILITY.md` this RFC moves:

- **Public API (§90).** Additive: `ShapingEngine`, `ShapeQuery`,
  `ShapedRun`, `ShapedGlyph`, optional `layoutText` argument,
  optional `cluster` on `TextQuad`, optional
  `HarfBuzzShapingEngine` on a subpath. **Minor.** Existing
  `layoutText("Motor 42", atlas)` stays bit-identical. No closed
  union widens.
- **Scene format versions (§79).** Unmoved in the first packet. A
  `Text` document already stores string + style, not glyph ids. Shaping
  is recovered at load from the string plus a font key (A-16:
  resources are keys). A font _key_ in the document is a later additive
  row if `@fourjs/assets` grows fonts.
- **Plugin API versions (§81).** Unmoved. A shaper is a value the
  application constructs (RFC 0002's preferred shape). No new
  capability token is required; one MAY be added later if plugins need
  to register alternate engines.
- **WebGPU/WebGL / solvers.** Unmoved. Do not regenerate the adapter
  block.
- **Browser/runtime (§90 §1).** WASM is already required for physics
  (Rapier). Shaping WASM is the same class of dependency, optional per
  app. The compatibility table should note "optional HarfBuzz-wasm for
  §56 full shaping" when the packet lands — expected, not a new
  verified-browser row.

## Prototype / benchmark

None run. What the first packet must measure:

1. **Bundle A/B.** ui-demo and first-2d-scene with and without a
   `HarfBuzzShapingEngine` import. Target: **zero gzip delta** when
   unused; wasm + adapter size reported (not gated) when used.
2. **Correctness.** Pinned wasm + an OFL face checked into
   `tests/fixtures/fonts/` (Noto Sans is OFL 1.1; Roboto is Apache-2.0,
   also acceptable, but is not an OFL face) + `"fi"` / `"لا"` (Arabic
   lam-alef) goldens for glyph ids, clusters, and advances. Same answers
   in the Vitest suites and in Chromium (Playwright).
3. **Init cost.** `WebAssembly.instantiate` time for the pinned build,
   once, so Application startup guides can say whether to lazy-load.
4. **Layout parity.** Identity shaper vs today's `layoutText` on the
   built-in ASCII corpus: byte-identical quads (the non-regression that
   makes this a minor API change).

## Open questions

1. **Subpath vs §98 package for the wasm.** Recommendation: subpath
   `@fourjs/text/harfbuzz` (umbrella `fourJS/text/harfbuzz`) first; amend
   §98 only if the blob cannot be kept off the default export.
2. **Which wasm build?** `harfbuzzjs`, rustybuzz-wasm, or a repo-owned
   build. Recommendation: leave to the packet, with the ABI and the
   pin-hash as the acceptance tests. Prefer a build that includes a
   bidi pass so we do not take two wasm files.
3. **Default `maximumFontBytes`.** 16 MiB vs A-23's 64 MiB texture
   default. Recommendation: 16 MiB — fonts that large are already
   pathological, and a font is more "decoded program-like tables" than
   a raster.
4. **Does `Label` grow a `shaper` option in the first packet?** It can
   pass through to `layoutText` with no new `@fourjs/ui` dependency.
   Recommendation: yes, optional, default omitted.
5. **Vertical text.** Interface-ready, implementation refused until a
   dedicated packet. Confirm.

## Review log

- **2026-09-10 — correction pass against the tree** (no decision changed):
  the umbrella's published specifier is `fourJS/…` (its `package.json`
  name), so `four/text/harfbuzz` became `@fourjs/text/harfbuzz` /
  `fourJS/text/harfbuzz`; `layoutText` walks code points (`for…of`), not
  code units; the shaper hook is a `TextLayoutOptions` field because the
  function takes an options record; vertical writing is refused with the
  existing `NOT_IMPLEMENTED` code instead of an invented one; the §96
  error split (bytes → `UNTRUSTED_INPUT_REJECTED`, option → `RangeError`)
  is stated; Roboto is Apache-2.0, not OFL, so the golden fixture names
  Noto Sans; the "no `lib.dom`" claim is restated as a seam rule since no
  tsconfig pins `lib`; the wasm size estimate is labelled as such.
  Added §7's glyph-id → quad rule (`GlyphAtlas.glyphsById`, code point as
  the identity id) — the draft had no way for a shaped glyph to reach an
  atlas entry.
