/**
 * A prose guard on one doc comment in `world.ts`.
 *
 * `PhysicsWorldInit.solver`'s comment explains why `@fourjs/physics` may not
 * map a solver name to a class itself: doing so would import every §102 solver
 * package, wasm images included, into every program that ever named
 * `PhysicsWorld`. The sentence that carried that argument read "every solver
 * Rapier and Box2D ship — wasm images included", which is hypothetical prose
 * about a design fourJS does not use, but a reader checking *whether Box2D is
 * available* meets it first and reads it as a shipping claim — against
 * `docs/COMPATIBILITY.md`, which correctly records `physics-box2d` as a
 * reserved stub (dogfood cycle 9, filed 2026-09-19).
 *
 * A text assertion rather than a behavioural one because the defect is
 * textual: nothing about resolution changed, and nothing about resolution
 * could have caught this. The guard is narrow — it pins the retired phrasing
 * and the replacement's two load-bearing facts, not the paragraph's wording.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const worldSource = readFileSync(
  fileURLToPath(new URL("../src/world.ts", import.meta.url)),
  "utf8",
);

/**
 * The same text as one line, with comment gutters gone. A doc comment is
 * hard-wrapped at 80 columns and Prettier re-wraps it on any edit, so a phrase
 * assertion against the raw file is really an assertion about where the line
 * breaks fell — a guard that fails for a reformat and passes for a rewrite is
 * worse than none.
 */
const worldProse = worldSource.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

describe("PhysicsWorldInit.solver prose (cycle 9 residue)", () => {
  it("no longer states that Rapier and Box2D both ship solvers", () => {
    expect(worldProse).not.toContain("solver Rapier and Box2D ship");
  });

  it("says which solver package actually ships an implementation", () => {
    expect(worldProse).toContain("@fourjs/physics-rapier");
    expect(worldProse).toContain("ships an implementation today");
  });

  it("names the reserved stubs and points at COMPATIBILITY.md", () => {
    expect(worldProse).toContain("physics-box2d");
    expect(worldProse).toContain("physics-soft");
    expect(worldProse).toContain("reserved");
    expect(worldProse).toContain("docs/COMPATIBILITY.md");
  });

  it("keeps the argument the sentence was there to make", () => {
    // The point is the import cost the registry design avoids, not a roster
    // of solvers. Losing it would trade one misreading for another.
    expect(worldProse).toContain("wasm images included");
    expect(worldProse).toContain("ever named `PhysicsWorld`");
  });
});
