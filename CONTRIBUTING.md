# Contributing to fourJS

Thanks for your interest. This document describes how work happens in this repository
today. Please read it before opening a pull request — the process here is unusual, because
the project is being built from a frozen specification through a work-packet plan.

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
The project is MIT licensed ([LICENSE](LICENSE)); contributions are accepted under the
same license.

## 1. Current state of the repository

- The **specification** — [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md), currently
  whatever revision tops its amendments table — is the working reference for everything
  in this repository. Parts I–XIII, sections 1–120 plus lettered insertions (6a, 6b, 7a,
  7b, 60a, …) and Appendices A–B.
- The **executable plan** is
  [`docs/plans/IMPLEMENTATION_PLAN.md`](docs/plans/IMPLEMENTATION_PLAN.md):
  small, self-contained **work packets** dispatched one at a time, phase by phase.
- **Implementation of the plan (§103–§113a) is complete.** Post-plan work continues via
  RFCs and gap filings. Check `TODO.md` and `CHANGELOG.md` for where things stand.
- Supporting docs: [`docs/POSITIONING.md`](docs/POSITIONING.md) (why the project exists),
  [`docs/ERRATA.md`](docs/ERRATA.md) (the archived PDF's defects and its numbering map),
  [`AGENTS.md`](AGENTS.md) (detailed orientation for contributors and AI agents),
  `MEMORY.md` (decisions and standing facts).

## 2. Commands

The workspace is a **Bun** monorepo (Bun ≥ 1.2, ESM only, strict TypeScript; RFC 0006).
Root scripts, and the level each one gates (plan §8, "Verification stack"):

| Command                         | Purpose                                        | Gate                        |
| ------------------------------- | ---------------------------------------------- | --------------------------- |
| `bun install --frozen-lockfile` | Install; never change the lockfile by hand     | always                      |
| `bun run build`                 | `tsc -b` across `packages/*` (sequential)      | every change                |
| `bun run test`                  | Per-package unit tests (Vitest)                | every change                |
| `bun run test:suites`           | Root cross-package suites in `tests/`          | phase exits                 |
| `bun run lint`                  | ESLint (type-checked)                          | every change                |
| `bun run format`                | Prettier write                                 | as needed                   |
| `bun run check-spec`            | `tools/check-spec.mjs` — spec integrity        | any change touching `docs/` |
| `bun run docs`                  | TypeDoc API docs into `docs/api`               | CI                          |
| `bun run example:build`         | Build `examples/first-2d-scene`                | CI                          |
| `bun run size`                  | size-limit — built example ≤ 150 kB gzip (§86) | CI                          |

These scripts live in the root `package.json`. Toolchain versions are **pinned exactly** —
do not install, upgrade, or add dependencies as part of an unrelated change.

## 3. How work is organized: work packets

Work is done in packets, not in free-form branches. The packet format (plan §2) is:

```
WP-<phase>.<n> [H|S] <title>
Depends: <packet ids or ->
Reads:   <files/§ to read first>
Files:   <exact files to create or edit>
Steps:   <numbered, imperative>
Done:    <shell commands that must succeed>
```

Rules that apply to anyone executing a packet:

1. **Scope.** Touch only the files the packet's `Files` list names. If the work seems to
   need more, stop and say so rather than improvising.
2. **Done means done.** A packet is complete only when its `Done` commands pass. Phase
   exit packets _verify and fix nothing_ — they file defects as `WP-<phase>.<n>-fix<k>`
   packets.
3. **One commit per packet**, message `WP-<id>: <title>`, staging only the packet's files.
   The lockfile is refreshed by the maintainer, not inside a feature packet.
4. **Dependency direction** follows the plan's §3.1 matrix exactly; never add or reverse
   an edge, and never add a package (§98, ERRATA E-3).
5. **Conventions are non-negotiable** (plan §1, spec §7a/§7b): right-handed Y-up in both
   2D and 3D, radians everywhere, **all times in seconds**, mutable math types with
   `out`-parameter hot paths, no `Math.random`/`Date.now` in simulation code (§33),
   one transform authority per node (§42), relative imports ending in `.js` (NodeNext).
6. **Phases close in order.** Phase N+1 does not start before phase N's exit is green and
   `MEMORY.md` / `TODO.md` / `CHANGELOG.md` are updated.

Tracking files (`MEMORY.md`, `TODO.md`, `CHANGELOG.md`) are maintained at phase
boundaries by the maintainer, not edited inside individual packets.

## 4. Architectural changes need an RFC

Per specification **§95 (Governance)** and the plan's governance rule (§2), a major
architectural change — including any packet that fixes a **new cross-package API surface
not already pinned by the specification or plan §3.5** — requires an RFC or ADR accepted
by the owner **before** implementation.

Process ([`docs/rfcs/README.md`](docs/rfcs/README.md)):

1. Copy `docs/rfcs/0000-template.md` to `docs/rfcs/NNNN-short-title.md` (next free number).
2. Fill in every section. §95 requires: context; proposed decision; alternatives;
   consequences; compatibility analysis; prototype or benchmark where practical;
   maintainer approval.
3. The owner accepts, rejects, or requests changes; the decision and date are recorded in
   the RFC header and echoed in `MEMORY.md`.

Small implementation choices inside a single package do not need an RFC. If you are
unsure, ask in the RFC's Context section whether the change crosses a package boundary —
if it does, it needs one.

## 5. Amending the specification

`docs/SPECIFICATION.md` is **frozen to contributors**. Do not edit it as part of an
ordinary change; if code and spec disagree, the spec wins until it is amended.

Amendments are an **owner decision**. When one is made:

- the change is recorded as a new row in the **amendments table** at the top of the spec,
  with a revision number, date, and summary;
- **§ numbering 1–120 is frozen** — new material gets letter-suffixed sections
  (e.g. 6a, 7b, 60a), never a renumbering;
- `bun run check-spec` (`tools/check-spec.mjs`) must pass afterwards — it verifies
  section sequence, fence balance, TOC anchors, and banned pre-revision terms;
- `docs/archive/four-js-specification.pdf` is never edited. It is frozen at the pre-1.0
  text and still contains the original numbering defects; translate references through
  [`docs/ERRATA.md`](docs/ERRATA.md).

## 6. Pull requests

- Branch from the default branch; keep the change to one packet's worth of work.
- Before opening a PR, run at minimum `bun run build`, `bun run test`, and
  `bun run lint`; add `bun run check-spec` if you touched anything under `docs/`.
- Describe which packet (or which spec section) the change implements, and call out
  anything you had to decide that the packet or spec did not pin down.
- CI runs the full verification stack; it must be green before merge.

## 7. Reporting problems

Open an issue describing what you expected (with a spec § reference where one applies),
what happened, and how to reproduce it. Spec defects and internal contradictions are
valuable — report them as issues rather than patching the spec.
