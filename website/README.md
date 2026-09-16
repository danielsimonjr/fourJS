# Website

Project website and documentation site per the documentation plan (§93):
installation and quick start, guides (scene graph, cameras, materials,
transform authority, fixed-step simulation, units, performance, custom
shaders, custom solver adapters, engineering dashboards, digital twins),
and API documentation generated from TypeScript declarations.

## What exists (2026-09-06)

`index.html` here, plus `.github/workflows/docs.yml`, which on every push to
`main` builds and deploys to GitHub Pages:

- **the API reference** — TypeDoc output for all 24 packages (`bun run docs`),
  at `/api/`;
- **the interactive demos** — every example directory that has a `main.ts`,
  built with `--base=/four.js/examples/<name>/` because Pages hosts this
  repository at `https://<owner>.github.io/four.js/`. A bundle built with the
  default base `"/"` requests its assets from the domain root and loads
  nothing. The example Vite configs deliberately do not hardcode a base: it
  is a property of _where_ a bundle is deployed, not of the example. Local
  `vite preview` and the Playwright browser gate still serve at `/`.
  Deployed paths: `/examples/<name>/` (nested flagships keep the
  `flagship/<demo>` segment). `character-controller` is in the `EXAMPLES`
  list. The three §93 names `first-animated-scene`, `first-physics-scene`
  and `mixed-scene` are thin entry points over existing scenes (see
  `docs/AUDIT-120.md` S-8);
- **the guides** — `docs/guides/*.md` rendered to `/guides/` at assemble
  time by `tools/render-guides.mjs` (same CSS as this `index.html`). Pages
  does not render Markdown, so the HTML is a deploy artifact and is not
  committed under `docs/guides/`. `index.html` links `/guides/` and each
  guide, and keeps the GitHub `.md` links beside them;
- **`index.html`** — a hand-written page: Demos, API, Guides, Specification.

**`--base` (why it is on the workflow, not in the example).** GitHub Pages
for this repository is a project site, so every asset URL must be prefixed
with `/four.js/`. `docs.yml` passes
`--base="/four.js/examples/$example/"` to each `vite build`. Do not put that
string in `examples/*/vite.config.ts`: preview and the browser gate would
then 404 locally.

Pages is enabled (Settings → Pages → source "GitHub Actions"). The workflow
is the deploy.

## A-25 stub publish (decision 2026-09-06)

**Publish the reserved stubs as real 0.x packages.** They already exist
(`physics-box2d`, `physics-soft`, `render-canvas`, `render-svg`), they
build, and the umbrella depends on them and re-exports each subpath.
Changesets cannot `ignore` them without also skipping `four`. Dropping the
subpaths would break §98; optional peers would push the resolution problem
onto consumers. A stub README that says "reserved; not implemented" is the
honest 0.x package. Recorded in `docs/COMPATIBILITY.md` as well.

`NPM_TOKEN` remains an owner secret. It cannot be added by a pull request;
`release.yml` skips the publish step until the secret exists.

## TypeDoc / TypeScript pin (re-verified 2026-09-06)

`typedoc@0.28.20` still does not support TypeScript 7 (TypeStrong/typedoc#3098,
waiting on 7.1). Leave the pin. Lift TypeDoc and TypeScript together, in one
PR, once TypeDoc's peer range includes 7.x.

## What is still staged

- **A live flagship embed as the site's centrepiece.** §93 wants the page
  itself to _be_ a scene. Since 2026-08-07 the flagship builds and deploys
  with the other demos; `index.html` is still a list of links, not an
  iframe or in-page canvas.
- **Installation and quick start on this page.** Deferred to first publish
  (§94 0.1): the install line would name packages nobody can install yet.

This directory was "Scaffold only — no implementation yet." until 2026-08-07.
Guides-on-Pages and the Demos section landed 2026-09-06; the remaining
shortfall is the centrepiece embed and the install line, not hosting.
