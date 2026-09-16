# Specification Errata and Correction Log

[`archive/four-js-specification.pdf`](archive/four-js-specification.pdf) (65 pages) contains internal defects,
recorded here as E-1, E-2, and E-3. **All three are now resolved in
[`SPECIFICATION.md`](SPECIFICATION.md)**, which was corrected by decision of the specification's
author (2026-07-28) and is the working reference for this repository. The PDF is preserved
unchanged as the original source and **still contains the defects** — use this file to translate
between the two.

---

## E-1 — `Part VII` was used for two different parts — ✅ RESOLVED

The PDF contains two distinct parts both labelled `Part VII`:

| Occurrence | Heading                                                                           | Covers (PDF numbering)                                                            |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| First      | `Part VII - Complete Graphics, Rendering, Application, and Platform Architecture` | §45 _Application Model_ → §67 _Clipping, Masks, and Stencils_ (continuing to §97) |
| Second     | `Part VII - Package Architecture`                                                 | §45 _Proposed Monorepo_ → §49 _Solver Packages_                                   |

**Resolution applied in `SPECIFICATION.md`:** the second occurrence became a new
`Part VIII - Package Architecture`, and every later part shifted by one:

| PDF                                                                             | SPECIFICATION.md     |
| ------------------------------------------------------------------------------- | -------------------- |
| Part VII - Complete Graphics, Rendering, Application, and Platform Architecture | Part VII (unchanged) |
| Part VII - Package Architecture                                                 | **Part VIII**        |
| Part VIII - Implementation Plan                                                 | **Part IX**          |
| Part IX - Public API Examples                                                   | **Part X**           |
| Part X - Flagship Demonstrations                                                | **Part XI**          |
| Part XI - Revised MVP                                                           | **Part XII**         |
| Part XII - Final Design Statement                                               | **Part XIII**        |

## E-2 — Section numbers 45–67 were assigned twice — ✅ RESOLVED

In the PDF, the second `Part VII` restarts section numbering at 45, so the range 45–67 is used
twice and bare references like "§49" are ambiguous.

**Resolution applied in `SPECIFICATION.md`:** the first range (§1–97) is unchanged; the second
range was renumbered by **+53** to §98–120, giving a single sequence 1–120. Map for the
renumbered sections:

| PDF § | SPECIFICATION.md § | Title                                          |
| ----- | ------------------ | ---------------------------------------------- |
| 45    | 98                 | Proposed Monorepo                              |
| 46    | 99                 | Motion Package                                 |
| 47    | 100                | Animation Package                              |
| 48    | 101                | Physics Package                                |
| 49    | 102                | Solver Packages                                |
| 50    | 103                | Phase 0 - Project Foundation                   |
| 51    | 104                | Phase 1 - Math, Scene, and Time                |
| 52    | 105                | Phase 2 - Motion Foundation                    |
| 53    | 106                | Phase 3 - Renderer Foundation                  |
| 54    | 107                | Phase 4 - Animation Core                       |
| 55    | 108                | Phase 5 - Physics API and First Solver Adapter |
| 56    | 109                | Phase 6 - Joints and Constraints               |
| 57    | 110                | Phase 7 - Physics-Animation Integration        |
| 58    | 111                | Phase 8 - Advanced Motion                      |
| 59    | 112                | Phase 9 - Particles and GPU Motion             |
| 60    | 113                | Phase 10 - Replay, Snapshots, and Diagnostics  |
| 61    | 114                | Basic Animated Object                          |
| 62    | 115                | Dynamic Physics Object                         |
| 63    | 116                | Motorized Hinge                                |
| 64    | 117                | Physics and Animation Blend                    |
| 65    | 118                | "One Scene, Everything Moves"                  |
| 66    | 119                | Engineering Demonstration                      |
| 67    | 120                | MVP Requirements                               |

Citation convention: plain section references (e.g. "§102") now mean `SPECIFICATION.md`
numbering. When citing the PDF, say so explicitly (e.g. "PDF §49, second range").

## E-3 — Solver packages contradiction — ✅ RESOLVED

The PDF's _Solver Packages_ section (PDF §49, second range) named four solver adapter packages
(`physics-rapier`, `physics-box2d`, `physics-matter`, `physics-cannon`), while the _Proposed
Monorepo_ tree (PDF §45, second range) listed only `physics-rapier`, `physics-box2d`, and
`physics-soft` (a soft-body package, not a solver adapter). A full cross-check of every
`@fourjs/<pkg>` reference found no other mismatches.

**Resolution (owner decision, previously recorded here and now applied to the text):** the
monorepo tree wins. §102 (Solver Packages) in `SPECIFICATION.md` now lists only
`@fourjs/physics-rapier` and `@fourjs/physics-box2d`, with a note that Matter.js and Cannon-es
(potential adapters per §37) may be added by future amendment. The scaffold contains
`physics-rapier`, `physics-box2d`, and `physics-soft` only; `physics-matter` and
`physics-cannon` must not be added without a further amendment.

## Extraction artifacts — ✅ REPAIRED

`SPECIFICATION.md` originally carried PDF text-extraction noise, all repaired in the corrected
rendering: kerning splits (`AScene`, `A void`, `A VIF`, `W orker-rendering`, `T ests`,
`Digital T win`, `T ooling`), the `eﬀicient` ligature, mid-word line-break hyphens (e.g.
`appli-`/`cation`), and the wrapped subtitle. Two line-end hyphens were genuine compounds and
were preserved: `human-readable`, `vector-level`. The corrected rendering also adds Markdown
headings (`##` parts, `###` sections); no normative wording was changed other than the E-3
resolution described above.

---

## Scope note: revisions vs. errata

This file covers only the PDF's extraction/numbering defects and their resolution.
Substantive amendments to the specification (revision 1.1 applying `SPEC-REVIEW.md` R-1–R-35,
revision 1.2 confirming the §86 payload budget) are recorded in the **amendments table at the
top of `SPECIFICATION.md`**, not here. The archived PDF is **frozen at the pre-1.0 text**: it
predates all revisions in addition to carrying the defects above.

## Non-defects (checked and dismissed)

Recorded so they are not "rediscovered" later:

- **Section 65 (PDF second range; now §118) is not missing.** Its title begins with a
  typographic quote (`"One Scene, Everything Moves"`), which heading scans can miss.
- **Repeated low numbers (1., 2., 3., …) scattered through the text are numbered _lists_,**
  not sections — e.g. the four fundamentals in §1 _Vision_. Only the PDF's 45–67 range was a
  genuine collision.
