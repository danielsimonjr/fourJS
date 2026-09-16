# RFC 0008 — §56 shaping engine (HarfBuzz-wasm): subagent plan

**Status:** plan only, no implementation. Written 2026-09-10 against branch
`claude/rfc-review-planning-s2clzd`. **Gated on the owner accepting RFC 0008**
(`docs/rfcs/0008-text-shaping-engine.md`, corrected 2026-09-10) **and** on the spec
amendment §56 requires ("recorded by amendment before that work begins" — the lead adds
the amendments-table row at acceptance, before wave 1).
**Format:** [`docs/plans/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §2 packets; §1
ground rules apply. **Crew:** at most **four** haiku-class agents with disjoint files,
three waves (§3). This is the riskiest of the three RFC plans because it introduces the
repository's second WebAssembly dependency; §2 and §7 exist to keep an agent from
inventing the wasm API.

---

## 1. What is being built

The RFC §8 first packet, nothing more: (1) `ShapingEngine` and its records in
`packages/text/src/shaping.ts` with an `IdentityShapingEngine` that reproduces today's
code-point walk; (2) `GlyphAtlas.glyphsById` (optional) filled by `buildGlyphAtlas` for the
built-in face with _code point = glyph id_; (3) `TextLayoutOptions.shaper?` and siblings,
`TextQuad.cluster?`, a per-run pen walk in `layoutText` that is **bit-identical** when no
shaper is passed; (4) `HarfBuzzShapingEngine` over the `harfbuzzjs` package, exported only
from the subpath `@fourjs/text/harfbuzz` (umbrella `fourJS/text/harfbuzz`), constructed
from **wasm bytes the application supplies** (no URL, no fetch inside the engine — RFC §4);
(5) the §96 `maximumFontBytes` limit (16 MiB default); (6) one OFL fixture font and
goldens for `"fi"` + `liga` and Arabic lam-alef; (7) bundle A/B proof and an init-cost
number. **Not built:** bidi (UAX #9) auto-resolution, wrapping, vertical text (refused
with `NOT_IMPLEMENTED`), SDF/MSDF, any font loader in `@fourjs/assets`, a 25th package.

## 2. Anti-hallucination sheet (read the file, do not recall)

| Fact                                                                                                                                                                                                           | Pinned at                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `@fourjs/text` depends on `core`, `math`, `geometry` only; `ui` depends on `text`; the umbrella `fourJS` re-exports `@fourjs/text` via `packages/fourjs/src/text.ts` (`export *`)                              | `packages/text/package.json`, `packages/ui/package.json`, plan §3.1     |
| The umbrella package's **name is `fourJS`** (`packages/fourjs/package.json:2`); subpaths are declared in its `exports` map as `"./text": { types, import }` pointing at `dist/text.*` built from `src/text.ts` | that file                                                               |
| `packages/text/package.json` `exports` today has only `"."`; adding `"./harfbuzz"` is the subpath mechanism                                                                                                    | that file                                                               |
| `layoutText(text, atlas, options)` — three positional args; options is `TextLayoutOptions { size, letterSpacing?, align? }`; the walk is `for (const char of text)` (code points)                              | `packages/text/src/text-layout.ts:122-160, 264-330`                     |
| `TextQuad { x0, y0, x1, y1, u0, v0, u1, v1, … }` (read the full interface at `text-layout.ts:86-118` before adding `cluster?`)                                                                                 | that file                                                               |
| `GlyphAtlas { width, height, data: Uint8Array, glyphs: ReadonlyMap<string, GlyphAtlasEntry>, fallback }`; `GlyphAtlasEntry { char, u0, v0, u1, v1, advance, blank, x, … }`                                     | `packages/text/src/glyph-atlas.ts:90-150`                               |
| The `Text` node (`packages/fourjs/src/text-node.ts`) and `Label` (`packages/ui/src/label.ts`) call `layoutText` and consume `TextLayout.quads`; neither imports wasm                                           | those files                                                             |
| `FourError(code, message, { context?, cause? })`; codes in use here: `UNTRUSTED_INPUT_REJECTED`, `INVALID_APPLICATION_STATE`, `NOT_IMPLEMENTED`; `isFourError` exists                                          | `packages/core/src/errors.ts`                                           |
| A-23 error split: content over a limit → `UNTRUSTED_INPUT_REJECTED`; an application-built option that is non-finite/non-positive → `RangeError` (§85)                                                          | RFC 0008 §4; `packages/render/src/raster.ts:222-260`                    |
| `Disposable` is `@fourjs/core`'s                                                                                                                                                                               | `packages/core/src/disposable.ts`                                       |
| Ids minted by the engine are monotonic counters, never clocks (§33)                                                                                                                                            | `packages/render/src/raster.ts:334` (`assignCanvasTextureId` precedent) |
| Fixture licences: **Noto Sans is OFL 1.1**; Roboto is Apache-2.0 (acceptable, but not OFL). The licence text file ships beside the font                                                                        | RFC 0008 prototype item 2                                               |
| Existing fixtures dir: `tests/fixtures/gltf/`; fonts go in a new `tests/fixtures/fonts/`                                                                                                                       | `ls tests/fixtures`                                                     |
| Vitest per package: `packages/text/tests/*.test.ts` import `../src/index.js`; cross-package suites in `tests/integration/` run via `bun run test:suites`                                                       | `packages/text/tests/text.test.ts`                                      |
| Umbrella subpath count is asserted in `packages/fourjs/tests/barrels.test.ts` (“all 25 umbrella subpath exports resolve”) — a new subpath must be added there                                                  | that file, MEMORY.md:515                                                |
| Size gate: `.size-limit.json` limits on built examples (`bun run examples:build && bun run size`); ui-demo is 50 kB gzip and imports text                                                                      | `.size-limit.json`, `tools/size-budgets.mjs`                            |
| Rapier precedent for wasm in the tree: `@dimforge/rapier{2,3}d-compat` is base64-embedded and loaded by the adapter; COMPATIBILITY §1 records "WebAssembly, for physics"                                       | `docs/COMPATIBILITY.md:102`, `packages/physics-rapier/src/init.ts`      |

**The `harfbuzzjs` API is not in this table on purpose.** Before writing a line against
it, A3 must open `node_modules/harfbuzzjs/README.md` and `node_modules/harfbuzzjs/hbjs.js`
after install and copy the _actual_ function names into the packet's _Verified API_ note.
The names A3 should expect to find (verify, do not assume): `hb.createBlob(bytes)`,
`hb.createFace(blob, index)`, `hb.createFont(face)`, `font.setScale(x, y)`,
`hb.createBuffer()`, `buffer.addText(text)`, `buffer.guessSegmentProperties()`,
`buffer.setDirection(...)`, `buffer.setScript(...)`, `buffer.setLanguage(...)`,
`hb.shape(font, buffer, features?)`, `buffer.json()` returning
`{ g, cl, ax, ay, dx, dy }` per glyph, and `.destroy()` on each object; the wasm file is
`hb.wasm` and `hbjs.js` wraps an instantiated `WebAssembly.Instance`. If any name differs,
the README wins and the note records the difference.

## 3. Roster, ownership, waves

| Agent                                       | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                | Wave                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **A1 — seam + identity engine + atlas ids** | `packages/text/src/shaping.ts` (new), `packages/text/src/glyph-atlas.ts` (edit: `glyphsById`), `packages/text/tests/shaping.test.ts` (new), `packages/text/tests/text.test.ts` (append: `glyphsById`)                                                                                                                                                                                                                                               | 1                                          |
| **A2 — layout consumer**                    | `packages/text/src/text-layout.ts` (edit), `packages/text/tests/text-layout-shaped.test.ts` (new), `packages/ui/src/label.ts` (edit: `shaper` pass-through), `packages/ui/tests/label.test.ts` (append), `packages/fourjs/src/text-node.ts` (edit: pass-through), `packages/fourjs/tests/text-node.test.ts` (append — locate the existing test for `Text` first)                                                                                    | 2                                          |
| **A3 — HarfBuzz adapter + subpath**         | `packages/text/package.json` (dependency + `./harfbuzz` export), `bun.lock` (via `bun add`), `packages/text/src/harfbuzz/index.ts` + `harfbuzz-shaping-engine.ts` (new), `packages/text/tsconfig.build.json` only if a second entry needs it, `packages/fourjs/package.json` (`./text/harfbuzz` export), `packages/fourjs/src/text-harfbuzz.ts` (new), `packages/fourjs/tests/barrels.test.ts` (edit), `packages/text/tests/harfbuzz.test.ts` (new) | 2                                          |
| **A4 — fixtures, goldens, measurements**    | `tests/fixtures/fonts/NotoSans-Regular.ttf` + `OFL.txt` (new), `tests/integration/text-shaping.test.ts` (new), `benchmarks/text-shaping-init.mjs` (new) + `benchmarks/results/text-shaping-init.json`, `tools/size-budgets.mjs` (append the A/B table row), `packages/text/src/index.ts` (edit: exports for A1/A2 names)                                                                                                                            | 2 (fixtures, index) → 3 (goldens after A3) |

Wave 1: A1 alone. Wave 2: A2, A3, A4-first-half in parallel (A2 and A3 both code against
A1's `shaping.ts`). Wave 3: A4's goldens and measurements once A3's adapter runs.

## 4. Packets

### WP-TS.1 [S] `ShapingEngine`, identity engine, atlas glyph ids — **A1**

**Reads first:** RFC §2, §5, §7; `glyph-atlas.ts` whole file; `text-layout.ts` header and
lines 264-330; `packages/render/src/raster.ts:1-130` (house style for a seam module header).

**Creates `packages/text/src/shaping.ts`:** the RFC §2 interfaces verbatim
(`ShapedGlyph`, `ShapedRun`, `ShapeQuery`, `ShapingEngine`), the direction union exported
as `export type ShapingDirection = "ltr" | "rtl" | "ttb" | "btt"`, and:

```ts
/** Default `maximumFontBytes` (RFC 0008 §4 / Q3): 16 MiB. */
export const DEFAULT_MAXIMUM_FONT_BYTES = 16 * 1024 * 1024;

/**
 * Today's walk as an engine: one glyph per code point, glyph id = code point,
 * cluster = UTF-16 index of that code point's first unit, advance = 1 "cell"
 * expressed in font units of 1000/em so that layout's scale is exact (see A2).
 * `addFont` accepts any bytes (they are ignored) but still enforces the limit.
 */
export class IdentityShapingEngine implements ShapingEngine {
  readonly name = "fourJS:identity";
  readonly version = "0.1.0";
  addFont(bytes: Uint8Array, options?: { maximumFontBytes?: number }): string; // "identity-font-<n>"
  removeFont(fontId: string): void; // unknown id → FourError INVALID_APPLICATION_STATE
  shape(query: ShapeQuery): readonly ShapedRun[]; // one run, direction from query (default "ltr"); "ttb"/"btt" → FourError NOT_IMPLEMENTED
  dispose(): void;
}
```

Limit rule (both engines share it — export a helper `validateFontBytes(bytes, maximumFontBytes)`):
non-finite or ≤ 0 `maximumFontBytes` → `RangeError` (§85); `bytes.byteLength` over the
limit → `FourError` `UNTRUSTED_INPUT_REJECTED` with `context: { byteLength, maximumFontBytes }`.

**Edits `glyph-atlas.ts`:** add `readonly glyphsById?: ReadonlyMap<number, GlyphAtlasEntry>`
to `GlyphAtlas` (optional, additive) and have `buildGlyphAtlas` populate it with
`codePointAt(0)` of each entry's `char`. Every existing test must pass unchanged.

**Tests (`packages/text/tests/shaping.test.ts`):** identity engine shapes `"Hi\n"` into ids
`[72, 105, 10]` with clusters `[0, 1, 2]`; a surrogate pair `"𝄞a"` yields ids
`[0x1D11E, 97]` with clusters `[0, 2]`; `rtl` query returns `direction: "rtl"` with glyphs
still in logical order (reversal is layout's job — RFC §7); `ttb` throws `NOT_IMPLEMENTED`;
limit tests per the rule above; ids are monotonic across two engines' `addFont`
(`identity-font-1`, `-2` — a per-engine counter, not global, is acceptable if documented).
Append to `text.test.ts`: `atlas.glyphsById.get(65)` is the `"A"` entry (`toBe`).

**Done when:** `cd packages/text && bun run build && bun run test` green; module header
written; A1 posts the export list to A4.

### WP-TS.2 [S] `layoutText` shaped path, `cluster`, pass-throughs — **A2**

**Reads first:** RFC §5 (font units → world units), §7; `text-layout.ts` in full; A1's
`shaping.ts`; `label.ts:1-100`; `text-node.ts:255-340`.

**Edits `text-layout.ts`:**

- `TextQuad` gains `readonly cluster?: number` (absent on the legacy path — do **not**
  set it to keep the legacy output _shape_ bit-identical; tests compare with `toEqual`).
- `TextLayoutOptions` gains `shaper?: ShapingEngine`, `fontId?: string`, `script?`,
  `language?`, `direction?: ShapingDirection`, `features?: Readonly<Record<string, number>>`
  (all optional; `fontId` required when `shaper` is set → else `RangeError` §85).
- New private `layoutShaped(...)`: for each `\n`-separated line, call
  `shaper.shape({ text: line, fontId, … })`; for each run, walk glyphs in logical order
  and, if `run.direction === "rtl"`, place them right-to-left **within the run** (compute
  the run width first, then pen from the right edge); quad width comes from the atlas
  entry (`glyphsById.get(glyphId) ?? atlas.fallback`), pen advance from
  `advanceX * size / UNITS_PER_EM` where `UNITS_PER_EM = 1000` is the documented scale
  both engines agree on (A1's identity engine emits 1000-per-cell advances; A3's adapter
  calls `font.setScale(1000, 1000)`), offsets likewise; `cluster` set on every quad;
  `letterSpacing` and `align` apply exactly as on the legacy path.
- Legacy path untouched: when `options.shaper` is `undefined`, control flows through the
  existing code with no new branches inside it.

**Pass-throughs:** `Label` and `Text` each accept the same optional fields and forward them
to `layoutText`; no new imports beyond types from `@fourjs/text`.

**Tests (`text-layout-shaped.test.ts`):** (1) parity — for 12 ASCII strings including
`\n` and `align: "center"`, `layoutText(s, atlas, { size })` `toEqual`
`layoutText(s, atlas, { size, shaper: new IdentityShapingEngine(), fontId })` **after
deleting `cluster` from the shaped quads** (state in the test that clusters are the one
additive field); (2) an `rtl` identity run of `"abc"` yields quads whose `x0` decrease
with glyph index; (3) a hand-built `ShapingEngine` stub returning one glyph for two
characters (a fake ligature) produces one quad with `cluster: 0` and the next quad
`cluster: 2`; (4) missing `fontId` with a shaper → `RangeError`; (5) `Label`/`Text` forward
`shaper` (spy stub records the call).

**Done when:** `packages/text`, `packages/ui`, `packages/fourjs` build + test green and the
legacy parity test passes with `toEqual` (bit-identical numbers, §90 minor).

### WP-TS.3 [M] `HarfBuzzShapingEngine` and the subpath — **A3**

**Reads first:** RFC §1–§6; A1's `shaping.ts`; `packages/physics-rapier/src/init.ts` (how the
tree already isolates wasm init failures); `packages/fourjs/package.json` exports;
`packages/fourjs/tests/barrels.test.ts`.

**Step 0 — dependency.** `cd packages/text && bun add --exact harfbuzzjs` (pin the version
it resolves; record it in the module header). If the network policy blocks the install,
**stop**: write the packet's _Blocked_ line naming the command and error, and do not
vendor or hand-write a wasm. Nothing else in this packet is possible without it.

**Step 1 — verified API note.** Open the installed README and wrapper; list the exact names
used below in a comment block at the top of `harfbuzz-shaping-engine.ts`.

**Creates `packages/text/src/harfbuzz/harfbuzz-shaping-engine.ts`:**

```ts
export interface HarfBuzzShapingEngineOptions {
  /** The `hb.wasm` bytes or a compiled module — supplied by the application (RFC §4: no URL). */
  readonly wasm: BufferSource | WebAssembly.Module;
  readonly maximumFontBytes?: number; // default DEFAULT_MAXIMUM_FONT_BYTES
}
export class HarfBuzzShapingEngine implements ShapingEngine {
  readonly name = "fourJS:harfbuzz";
  readonly version: string; // `harfbuzzjs@<pinned>`
  /** Async because `WebAssembly.instantiate` is; the only async member. A wasm that fails to instantiate rejects with FourError `UNTRUSTED_INPUT_REJECTED` carrying `cause` (the bytes are content the application handed over). */
  static create(
    options: HarfBuzzShapingEngineOptions,
  ): Promise<HarfBuzzShapingEngine>;
  addFont(bytes, options?): string; // validateFontBytes → createBlob/createFace/createFont; setScale(1000, 1000); id "harfbuzz-font-<n>"
  removeFont(fontId): void; // destroy font/face/blob; unknown → INVALID_APPLICATION_STATE
  shape(query): readonly ShapedRun[]; // createBuffer, addText, set direction/script/language if given else guessSegmentProperties, hb.shape with `features` as "liga=1,kern=1" (check README for the accepted form), buffer.json() → ShapedGlyph[]; destroy buffer in `finally`
  dispose(): void; // remove every font; subsequent calls → INVALID_APPLICATION_STATE
}
```

Rules: every wasm call is wrapped so a trap or a thrown wrapper error becomes a `FourError`
`UNTRUSTED_INPUT_REJECTED` (for `addFont`) or `INVALID_APPLICATION_STATE` (for `shape`)
carrying `cause`; `ttb`/`btt` → `NOT_IMPLEMENTED` before touching wasm; `script`/`language`
strings are passed through unvalidated to HarfBuzz (it tolerates unknown tags) but
`direction` is validated against the union. The pinned wasm's SHA-256 is computed once in
the test from `node_modules/harfbuzzjs/hb.wasm` and stored as a literal in
`harfbuzz.test.ts` (RFC §5's "pin-hash").

**Subpath:** `packages/text/src/harfbuzz/index.ts` re-exports the class and options;
`packages/text/package.json` `exports` gains `"./harfbuzz": { "types": "./dist/harfbuzz/index.d.ts", "import": "./dist/harfbuzz/index.js" }`
(confirm `tsc -b` emits that path — it does for `src/harfbuzz/index.ts` under the existing
`rootDir`; if not, read `tsconfig.build.json` and report). The **root** `src/index.ts` must
**not** export anything from `./harfbuzz/` — that is the whole tree-shaking argument.
Umbrella: `packages/fourjs/src/text-harfbuzz.ts` = `export * from "@fourjs/text/harfbuzz";`,
`packages/fourjs/package.json` gains `"./text/harfbuzz"`, and `barrels.test.ts`'s subpath
list gains the entry (its count assertion moves 25 → 26).

**Tests (`packages/text/tests/harfbuzz.test.ts`)** — read `hb.wasm` from
`node_modules/harfbuzzjs` with `node:fs` and a font from A4's fixture path (if the fixture
is not yet present in wave 2, use a tiny font the test itself cannot fabricate — so this
suite `describe.skipIf(!existsSync(fixture))` until wave 3): `create` succeeds; hash of the
wasm equals the literal; `addFont` over the limit → `UNTRUSTED_INPUT_REJECTED`; garbage
bytes → `UNTRUSTED_INPUT_REJECTED` (not a raw wasm trap); `shape("fi", { liga: 1 })` returns
fewer glyphs than code points; `ttb` → `NOT_IMPLEMENTED`; `dispose` then `shape` →
`INVALID_APPLICATION_STATE`.

**Done when:** `packages/text` and `packages/fourjs` build + test green; `bun run build`
at the root emits `packages/text/dist/harfbuzz/index.js`; the root barrel does not name
`harfbuzz` (grep).

### WP-TS.4 [S] Fixtures, goldens, measurements, barrel exports — **A4**

**Wave 2 (no dependency on A3):**

- `packages/text/src/index.ts`: export A1's and A2's new names (types and values) in the
  house grouping. Not the harfbuzz names.
- Fixture: obtain `NotoSans-Regular.ttf` (OFL 1.1) from the Noto project's official
  distribution; commit it as `tests/fixtures/fonts/NotoSans-Regular.ttf` with
  `tests/fixtures/fonts/OFL.txt` (the licence text verbatim) and a `README.md` naming
  source URL, version, and SHA-256. If the network policy blocks the download, **stop and
  report**; do not substitute a font whose licence you have not read.

**Wave 3 (after A3):**

- `tests/integration/text-shaping.test.ts`: with the real wasm and fixture — golden 1:
  `"fi"` + `{ liga: 1 }` → glyph count 1, `cluster` `[0]`, `advanceX` equal to a literal
  recorded on first run; golden 2: `"لا"` (U+0644 U+0627) with `direction: "rtl"`,
  `script: "arab"` → one lam-alef ligature glyph, cluster `[0]`; golden 3: `"Hello"` → 5
  glyphs, strictly positive advances, clusters `[0..4]`; then run each golden through
  `layoutText` with the fixture-backed atlas stub (`glyphsById` containing only
  `fallback`-shaped entries is fine — geometry, not images) and record the quad `x0`s as
  literals. Two calls → `toEqual` (§33). Mark the literals `// recorded YYYY-MM-DD, harfbuzzjs@<ver>`.
- `benchmarks/text-shaping-init.mjs`: time `HarfBuzzShapingEngine.create` (cold, 5 runs)
  and `shape("The quick brown fox")` (warm, 1 000 runs) with the harness; register in
  `SUITE`; commit the results JSON.
- Bundle A/B: `bun run examples:build && bun run size` must pass unchanged (ui-demo,
  first-2d-scene at zero delta — RFC prototype item 1). Then build a throwaway example
  (in the scratchpad, **not committed**) that imports `fourJS/text/harfbuzz` and record its
  gzip size in a new row of the table in `tools/size-budgets.mjs` as "opt-in cost, not
  gated".

**Done when:** `bun run test:suites` green, results JSON committed, size gate unchanged.

## 5. Lead's closing packet

1. Full gate (§6).
2. Spec amendment row (revision 1.15): "§56 shaping-engine decision recorded — RFC 0008
   accepted …; the default engine remains the identity walk; HarfBuzz-compatible WASM is
   optional on `@fourjs/text/harfbuzz`"; edit §56's staging sentence to point at the RFC;
   `bun run check-spec`.
3. `docs/COMPATIBILITY.md` §1: add "optional HarfBuzz-wasm for §56 full shaping" beside the
   Rapier wasm note (RFC compatibility section); §6 package table if it lists subpaths.
4. `MEMORY.md`, `TODO.md` (close the "Before §56 full text shaping: RFC the shaping engine"
   row's residue; open a "wrapping / bidi auto / vertical" follow-up row), `CHANGELOG.md`.

## 6. Gate

```
bun run build && bun run lint && bun run test && bun run test:suites
bun run coverage
bun run examples:build && bun run size
bun run check-spec && node tools/check-docs.mjs
bun run graph:check
```

## 7. Hallucination traps specific to this RFC

- The umbrella specifier is `fourJS/…`, never `four/…`.
- `layoutText` walks **code points**; clusters are **UTF-16 indices** (what a caret needs).
- The wasm is **never fetched by the engine**; the application passes bytes (RFC §4).
- No `UNSUPPORTED_TEXT_FEATURE` code exists or is added; use `NOT_IMPLEMENTED`.
- Roboto is not OFL. Use Noto Sans (OFL) and ship `OFL.txt`.
- Do not add bidi resolution, wrapping, or SDF; do not touch `@fourjs/assets`.
- Do not export the adapter from `@fourjs/text`'s root barrel — ui-demo's 50 kB gate is the
  proof it stayed out.
- `Intl.Segmenter` is not a shaper and must not appear in `@fourjs/text` in this packet.
