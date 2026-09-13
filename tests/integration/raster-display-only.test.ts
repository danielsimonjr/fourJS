/**
 * §77a / RFC 0004 — painted pixels are **display content, never simulation
 * input**, and the §96 boundary that keeps untrusted content from ever
 * becoming a paint source (2026-08-29).
 *
 * This is §40's display-only rule with one word changed — "inexact" becomes
 * "unreproducible" — and this file is the direct analogue of
 * `units-display.test.ts`, which is that rule's enforcement. Host-rendered
 * raster output is not reproducible: font rasterization, anti-aliasing, and
 * GPU-backed `getImageData` all differ by platform, browser, and driver, so a
 * fixed step, a §33 checksum, a §34 snapshot, or a replay document that read a
 * painted pixel would make §34's replay guarantee false on every platform at
 * once. The rule (§77a):
 *
 * > No value derived from a `RasterSource`, a `CanvasTexture`, or a
 * > `CanvasViewWidget`'s content may reach a fixed step, a §33 checksum, a §34
 * > snapshot, or a replay document.
 *
 * ## What is enforced, and the honest limit of it
 *
 * **This is a reachability rule, not a readability rule.** The scan below
 * fails any package source outside {@link ALLOWED} that names the raster
 * module — most simulation packages cannot see `@fourjs/render` at all under
 * the frozen §3.1 matrix, and the scan states the rule for the ones that
 * could and for every package added later. What it cannot enforce:
 * `MaterialTexture.data` is public (the upload path reads it), so an
 * application that reads `canvasTexture.data` and branches its own fixed-step
 * logic on a pixel has broken its own determinism — the engine documents
 * that; no test can prevent it.
 *
 * ## The §96 half
 *
 * A `RasterSource.paint` is **application code the application imported** — a
 * function value, passed to a constructor. It is not loaded content, it is
 * not named by a scene document, and `CanvasTexture` accepts no URL and no
 * module specifier — RFC 0002's plugin rule in a second place, asserted here
 * the same two ways: `@ts-expect-error` that the constructor admits no string
 * (`bun run typecheck:tests` runs it), and the scan's guarantee that neither
 * `@fourjs/serialization` nor `@fourjs/assets` — the two packages that touch
 * §96's untrusted content — can reach the raster module at all. §77a's "no
 * §79 representation" is what makes the second half true by construction: a
 * painted surface has no key, so no document can name one.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { CanvasTexture } from "@fourjs/render";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");

/**
 * The only files permitted to name the §77a raster module (RFC 0004 §3):
 * `@fourjs/render` owns it, `@fourjs/render-webgl` uploads it (through the
 * `MaterialTexture` path it already has — listed so a future explicit read is
 * a decision here, not an accident there), and the `fourJS` umbrella
 * (`packages/fourjs`) re-exports it. Until 2026-09-10 this entry was spelled
 * `"four"`, which matches no directory; it passed only because the umbrella
 * never names the raster types. Everything else is a simulation-adjacent package until someone argues
 * otherwise in writing — editing this list is deliberately a visible act, per
 * the §40 precedent.
 */
const ALLOWED_PACKAGES: ReadonlySet<string> = new Set([
  "render",
  "render-webgl",
  "fourjs",
]);

/** Every `.ts` file under `packages/<name>/src`, repository-relative. */
function packageSources(): string[] {
  const out: string[] = [];
  const packagesDir = join(repositoryRoot, "packages");
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, "src");
    let stats;
    try {
      stats = statSync(src);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) {
      continue;
    }
    walk(src, out);
  }
  return out.map((file) => relative(repositoryRoot, file));
}

/** Depth-first collection of `.ts` files — `src` has no build output. */
function walk(directory: string, out: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
}

/**
 * Names that only appear in a file that has reached for the §77a raster tier.
 * The module path catches a relative import inside `@fourjs/render`; the
 * identifiers catch a cross-package one, whatever spelling the import takes.
 */
const FORBIDDEN = [
  /from\s+"[^"]*\/host-texture\.js"/,
  /\bImageBitmapTexture\b/,
  /\bVideoTexture\b/,
  /\bVideoTextureSource\b/,
  /from\s+"[^"]*\/gpu-readback\.js"/,
  /\bGpuReadbackSource\b/,
  /\bGpuReadbackSourceOptions\b/,
  /\bisGpuReadbackSource\b/,
  /from\s+"[^"]*\/raster\.js"/,
  /\bRasterSource\b/,
  /\bRasterOrigin\b/,
  /\bCanvasTexture\b/,
  /\bCanvasTextureOptions\b/,
];

describe("§77a painted pixels stay out of the simulation (§33–§34)", () => {
  it("is named by no package source outside the render tier and the umbrella", () => {
    const offenders: string[] = [];
    for (const file of packageSources()) {
      const parts = file.split(sep);
      // parts = ["packages", "<name>", "src", ...]
      if (ALLOWED_PACKAGES.has(parts[1])) {
        continue;
      }
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(source)) {
          offenders.push(`${file} matches ${pattern.source}`);
          break;
        }
      }
    }
    expect(
      offenders,
      "§77a's painted pixels are unreproducible by construction; a simulation " +
        "path that reads them breaks replay determinism (§33–§34), and " +
        "@fourjs/serialization / @fourjs/assets reaching them would open §96's " +
        "boundary. If a package legitimately displays painted content, add it " +
        "to ALLOWED_PACKAGES with a dated note, after confirming nothing on a " +
        "fixed-step path touches the import.",
    ).toEqual([]);
  });

  it("scans a plausible number of files, so a broken walk cannot pass vacuously", () => {
    const files = packageSources();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join("packages", "render", "src", "raster.ts"));
    expect(files).toContain(join("packages", "physics", "src", "world.ts"));
    expect(files).toContain(
      join("packages", "serialization", "src", "format.ts"),
    );
  });
});

describe("§96: untrusted content can never become a paint source", () => {
  it("admits no string and no URL where a RasterSource is expected", () => {
    // @ts-expect-error §96: a module specifier is not a raster source, and the
    // type system is where that is enforced — never a runtime check somebody
    // forgets. (`bun run typecheck:tests` is what runs this assertion.)
    expect(() => new CanvasTexture("@vendor/minimap")).toThrow(RangeError);
    // A URL is a string with a parser in front of it, and so is anything a
    // §79 document could carry.
    expect(() => {
      // @ts-expect-error A URL is not a raster source either — nothing here
      // fetches, decodes, or resolves; CanvasTexture reads a value's bytes.
      new CanvasTexture(new URL("https://example.invalid/x"));
    }).toThrow(RangeError);
  });
});
