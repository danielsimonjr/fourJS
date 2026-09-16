/**
 * Unit tests for §50's SVG path-data bridge (`R-26`).
 *
 * ## What is asserted, and against what
 *
 * A parser has one easy oracle and one honest one. The easy one is "these are
 * the commands it produced", which pins an answer without saying whether the
 * answer is the *shape*; the honest one is geometry. So the arc tests do not
 * compare centre parameters against hand-computed constants — they assert that
 * the arc **passes through the endpoints the document named**, on an ellipse of
 * the radii it named, turning the way the flags said. That oracle is written
 * here, independently of the module, out of `cos` and `sin`.
 *
 * The grammar tests are the other half, and they are exhaustive by
 * construction: all ten commands in both cases, every separator form the
 * grammar admits (including the two that surprise people — `1.5.5` is two
 * numbers, and arc flags may abut what follows them), and every documented
 * refusal.
 *
 * ## Round trips are properties, not snapshots
 *
 * `parse → format → parse` is asserted as an **identity on the command list**
 * for paths without arcs, and as shape equality within a few ulps for paths
 * with them. Snapshotting the `d` string instead would pass just as happily if
 * both directions were wrong in the same way.
 *
 * ## Hostile input gets its own block
 *
 * ~30 000 fuzzed strings — random bytes, mutated valid paths, and adversarial
 * repeats — assert the totality claim in this module's header: every input
 * either yields a path that re-exports and re-imports, or throws one of the
 * three documented error types. Nothing else, and nothing that hangs.
 */

import { FourError, SeededRandom } from "@fourjs/core";
import { Matrix3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAXIMUM_PATH_DATA_LENGTH,
  Path,
  formatSvgPathData,
  parseSvgPathData,
  type PathArcCommand,
  type Point2D,
} from "../src/index.js";

// Contention under `bun run test --concurrency=4`: this file passes alone and
// times out at the 5 s default when the Windows runner is busy. Same shape as
// the coverage flake in `packages/render/tests/shape.test.ts`.

/** The arc oracle: a point on an arc's ellipse, written here, not imported. */
function ellipsePoint(arc: PathArcCommand, theta: number): Point2D {
  const localX = arc.radiusX * Math.cos(theta);
  const localY = arc.radiusY * Math.sin(theta);
  const cos = Math.cos(arc.rotation);
  const sin = Math.sin(arc.rotation);
  return {
    x: arc.centerX + localX * cos - localY * sin,
    y: arc.centerY + localX * sin + localY * cos,
  };
}

/** The single arc in a path parsed from one `A` command. */
function soleArc(path: Path): PathArcCommand {
  const arc = path.commands.find((command) => command.kind === "arc");
  expect(arc).toBeDefined();
  return arc as PathArcCommand;
}

/** Every command's kind, in order — the cheap structural assertion. */
function kinds(path: Path): string[] {
  return path.commands.map((command) => command.kind);
}

describe("parseSvgPathData — the `d` grammar", { timeout: 30_000 }, () => {
  it("reads the moveto/lineto family, absolute and relative", () => {
    const absolute = parseSvgPathData("M 10 20 L 30 40 H 50 V 60 Z");
    expect(kinds(absolute)).toEqual(["move", "line", "line", "line", "close"]);
    expect(absolute.commands[1]).toEqual({ kind: "line", x: 30, y: 40 });
    expect(absolute.commands[2]).toEqual({ kind: "line", x: 50, y: 40 });
    expect(absolute.commands[3]).toEqual({ kind: "line", x: 50, y: 60 });

    const relative = parseSvgPathData("m 10 20 l 20 20 h 20 v 20 z");
    expect(relative.commands).toEqual(absolute.commands);
  });

  it("treats extra moveto argument sets as implicit linetos", () => {
    const path = parseSvgPathData("M 0 0 1 1 2 2");
    expect(kinds(path)).toEqual(["move", "line", "line"]);
    expect(path.commands[2]).toEqual({ kind: "line", x: 2, y: 2 });

    // Relative: each implicit lineto is relative to the one before it.
    const chained = parseSvgPathData("m 0 0 1 1 1 1");
    expect(chained.commands[2]).toEqual({ kind: "line", x: 2, y: 2 });
  });

  it("repeats an argument set for every command that takes one", () => {
    expect(kinds(parseSvgPathData("M0 0L1 1 2 2 3 3"))).toEqual([
      "move",
      "line",
      "line",
      "line",
    ]);
    expect(kinds(parseSvgPathData("M0 0H1 2 3"))).toHaveLength(4);
    expect(kinds(parseSvgPathData("M0 0V1 2 3"))).toHaveLength(4);
    expect(kinds(parseSvgPathData("M0 0Q1 1 2 2 3 3 4 4"))).toEqual([
      "move",
      "quadratic",
      "quadratic",
    ]);
    expect(kinds(parseSvgPathData("M0 0C1 1 2 2 3 3 4 4 5 5 6 6"))).toEqual([
      "move",
      "cubic",
      "cubic",
    ]);
  });

  it("reads cubic and quadratic curves and their smooth shorthands", () => {
    const cubic = parseSvgPathData("M0 0 C1 2 3 4 5 6 S7 8 9 10");
    expect(kinds(cubic)).toEqual(["move", "cubic", "cubic"]);
    // The shorthand reflects the previous second control point about (5, 6).
    expect(cubic.commands[2]).toEqual({
      kind: "cubic",
      control1X: 7,
      control1Y: 8,
      control2X: 7,
      control2Y: 8,
      x: 9,
      y: 10,
    });

    const quadratic = parseSvgPathData("M0 0 Q2 4 4 0 T8 0");
    expect(quadratic.commands[2]).toEqual({
      kind: "quadratic",
      controlX: 6,
      controlY: -4,
      x: 8,
      y: 0,
    });
  });

  it("starts a smooth shorthand at the current point when nothing precedes it", () => {
    // `S` after a lineto has no cubic to reflect: SVG says the first control
    // point coincides with the current point.
    const afterLine = parseSvgPathData("M0 0 L4 0 S6 2 8 0");
    expect(afterLine.commands[2]).toEqual({
      kind: "cubic",
      control1X: 4,
      control1Y: 0,
      control2X: 6,
      control2Y: 2,
      x: 8,
      y: 0,
    });

    const afterLineT = parseSvgPathData("M0 0 L4 0 T8 0");
    expect(afterLineT.commands[2]).toEqual({
      kind: "quadratic",
      controlX: 4,
      controlY: 0,
      x: 8,
      y: 0,
    });
  });

  it("reflects repeatedly within one shorthand run", () => {
    const path = parseSvgPathData("M0 0 C1 1 2 2 3 3 S4 4 5 5 S6 6 7 7");
    const third = path.commands[3];
    expect(third.kind).toBe("cubic");
    // Reflecting (4, 4) about (5, 5) gives (6, 6).
    expect(third).toMatchObject({ control1X: 6, control1Y: 6 });

    const quadratics = parseSvgPathData("M0 0 Q1 1 2 2 T4 4 T6 6");
    expect(kinds(quadratics)).toEqual([
      "move",
      "quadratic",
      "quadratic",
      "quadratic",
    ]);
  });

  it("keeps the subpath's first point as the current point after a close", () => {
    const path = parseSvgPathData("M10 10 L20 10 Z l5 5");
    expect(kinds(path)).toEqual(["move", "line", "close", "line"]);
    // Relative to (10, 10) — the subpath's start, not (20, 10).
    expect(path.commands[3]).toEqual({ kind: "line", x: 15, y: 15 });
  });

  it("treats a redundant close as a no-op rather than a refusal", () => {
    expect(kinds(parseSvgPathData("M0 0 L1 1 Z Z"))).toEqual([
      "move",
      "line",
      "close",
    ]);
    expect(kinds(parseSvgPathData("M0 0 z z"))).toEqual(["move", "close"]);
  });

  it("accepts every separator form the grammar admits", () => {
    const expected = parseSvgPathData("M 1 2 L 3 4").commands;
    for (const source of [
      "M1,2L3,4",
      "M1 2L3 4",
      "M1\t2\nL3\r4",
      "M1\f2L3\f4",
      "M 1 , 2 L 3 , 4",
      "  M1 2 L3 4  ",
    ]) {
      expect(parseSvgPathData(source).commands, source).toEqual(expected);
    }
  });

  it("reads unseparated numbers the way the grammar's greedy scan does", () => {
    // `1-2` is two numbers; a sign is its own separator.
    expect(parseSvgPathData("M1-2L-3-4").commands[1]).toEqual({
      kind: "line",
      x: -3,
      y: -4,
    });
    // `1.5.5` is `1.5` then `.5` — the fractional part stops at the second dot.
    expect(parseSvgPathData("M1.5.5L.5.5").commands[0]).toEqual({
      kind: "move",
      x: 1.5,
      y: 0.5,
    });
    // Trailing dot, leading dot, explicit plus, and exponents in both cases.
    expect(parseSvgPathData("M5.+.5L1e2 1E2").commands).toEqual([
      { kind: "move", x: 5, y: 0.5 },
      { kind: "line", x: 100, y: 100 },
    ]);
    expect(parseSvgPathData("M1e+2 1e-2").commands[0]).toEqual({
      kind: "move",
      x: 100,
      y: 0.01,
    });
  });

  it("reads arc flags that abut the numbers after them", () => {
    const spaced = parseSvgPathData("M0 0 A 1 1 0 0 1 1 1");
    const packed = parseSvgPathData("M0 0a1 1 0 011 1");
    expect(packed.commands).toEqual(spaced.commands);
  });

  it("returns an empty path for empty and whitespace-only data", () => {
    expect(parseSvgPathData("").isEmpty).toBe(true);
    expect(parseSvgPathData("   \n\t ").isEmpty).toBe(true);
  });
});

describe("parseSvgPathData — arcs (SVG 1.1 F.6)", { timeout: 30_000 }, () => {
  it("puts a quarter-turn arc on the ellipse the document named", () => {
    const path = parseSvgPathData("M100 0 A100 100 0 0 1 0 100");
    const arc = soleArc(path);
    expect(arc.radiusX).toBeCloseTo(100, 9);
    expect(arc.radiusY).toBeCloseTo(100, 9);
    expect(arc.centerX).toBeCloseTo(0, 9);
    expect(arc.centerY).toBeCloseTo(0, 9);
    // sweep-flag 1 means the positive angle direction.
    expect(arc.deltaAngle).toBeGreaterThan(0);
    expect(arc.deltaAngle).toBeCloseTo(Math.PI / 2, 9);

    const start = ellipsePoint(arc, arc.startAngle);
    const end = ellipsePoint(arc, arc.startAngle + arc.deltaAngle);
    expect(start.x).toBeCloseTo(100, 9);
    expect(start.y).toBeCloseTo(0, 9);
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.y).toBeCloseTo(100, 9);
  });

  it("honours all four flag combinations, and only they distinguish the arcs", () => {
    const sweeps: number[] = [];
    for (const largeArc of [0, 1]) {
      for (const sweep of [0, 1]) {
        const arc = soleArc(
          parseSvgPathData(
            `M0 0 A5 5 0 ${String(largeArc)} ${String(sweep)} 6 6`,
          ),
        );
        const start = ellipsePoint(arc, arc.startAngle);
        const end = ellipsePoint(arc, arc.startAngle + arc.deltaAngle);
        expect(start.x).toBeCloseTo(0, 8);
        expect(start.y).toBeCloseTo(0, 8);
        expect(end.x).toBeCloseTo(6, 8);
        expect(end.y).toBeCloseTo(6, 8);
        expect(Math.sign(arc.deltaAngle)).toBe(sweep === 1 ? 1 : -1);
        expect(Math.abs(arc.deltaAngle) > Math.PI).toBe(largeArc === 1);
        sweeps.push(arc.deltaAngle);
      }
    }
    expect(new Set(sweeps).size).toBe(4);
  });

  it("rotates the ellipse by the degrees the document gives, in radians", () => {
    const arc = soleArc(parseSvgPathData("M0 0 A20 10 45 0 1 20 20"));
    expect(arc.rotation).toBeCloseTo(Math.PI / 4, 12);
    const end = ellipsePoint(arc, arc.startAngle + arc.deltaAngle);
    expect(end.x).toBeCloseTo(20, 8);
    expect(end.y).toBeCloseTo(20, 8);
  });

  it("scales radii up when they are too small to span the chord (F.6.6.2)", () => {
    // Radius 1 cannot connect points 10 apart; the correction is uniform.
    const arc = soleArc(parseSvgPathData("M0 0 A1 1 0 0 1 10 0"));
    expect(arc.radiusX).toBeCloseTo(5, 9);
    expect(arc.radiusY).toBeCloseTo(5, 9);
    expect(arc.centerX).toBeCloseTo(5, 9);

    // The scaling is uniform, so an eccentric ellipse keeps its eccentricity.
    const eccentric = soleArc(parseSvgPathData("M0 0 A1 2 0 0 1 10 0"));
    expect(eccentric.radiusY / eccentric.radiusX).toBeCloseTo(2, 9);
  });

  it("takes the absolute value of a negative radius (F.6.6.1)", () => {
    const negative = parseSvgPathData("M0 0 A-5 -5 0 0 1 6 6");
    const positive = parseSvgPathData("M0 0 A5 5 0 0 1 6 6");
    expect(negative.commands).toEqual(positive.commands);
  });

  it("makes a zero radius a straight line (F.6.6.1)", () => {
    expect(kinds(parseSvgPathData("M0 0 A0 5 0 0 1 6 6"))).toEqual([
      "move",
      "line",
    ]);
    expect(kinds(parseSvgPathData("M0 0 A5 0 0 0 1 6 6"))).toEqual([
      "move",
      "line",
    ]);
  });

  it("omits an arc whose endpoints coincide (F.6.2)", () => {
    expect(kinds(parseSvgPathData("M3 4 A5 5 0 1 1 3 4"))).toEqual(["move"]);
  });

  it("lets an arc's start retarget the segment that reaches it", () => {
    // The rounded-rectangle defect, in miniature. SVG guarantees the arc
    // begins at the current point; §51's arc begins at
    // `centre + R(rotation)·(rx cos θ₁, ry sin θ₁)`, which cannot be made to
    // land on an arbitrary point exactly. Left alone the two disagree by ulps,
    // §51 fills the gap with its implicit connecting segment, and the
    // flattening acquires a zero-area spike that §52 refuses. The reader
    // therefore moves the *line's* endpoint onto the arc's start.
    const path = parseSvgPathData("M 0 12 L 0 12 A 12 12 0 0 1 12 0");
    const line = path.commands[1];
    const arc = soleArc(path);
    const start = ellipsePoint(arc, arc.startAngle);
    expect(line.kind).toBe("line");
    expect(line).toMatchObject({ x: start.x, y: start.y });
    // And the move is sub-ulp: it is smaller than the conversion's own error.
    expect(Math.abs(start.y - 12)).toBeLessThan(1e-12);

    // The flattening therefore has no doubled-back vertex where the line meets
    // the arc — which is the whole point.
    const [ring] = parseSvgPathData(
      "M 12 0 L 88 0 A 12 12 0 0 1 100 12 L 100 48 A 12 12 0 0 1 88 60 " +
        "L 12 60 A 12 12 0 0 1 0 48 L 0 12 A 12 12 0 0 1 12 0 Z",
    ).flatten(0.02);
    for (let index = 1; index < ring.length; index += 1) {
      const dx = ring[index].x - ring[index - 1].x;
      const dy = ring[index].y - ring[index - 1].y;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(1e-9);
    }
  });

  it("retargets a curve's endpoint too, not only a line's", () => {
    for (const source of [
      "M 0 0 C 4 0 8 4 12 12 A 12 12 0 0 1 24 24",
      "M 0 0 Q 6 6 12 12 A 12 12 0 0 1 24 24",
    ]) {
      const path = parseSvgPathData(source);
      const arc = soleArc(path);
      const start = ellipsePoint(arc, arc.startAngle);
      expect(path.commands[1], source).toMatchObject({
        x: start.x,
        y: start.y,
      });
    }
  });

  it("writes a held segment unchanged when no arc follows it", () => {
    // The deferral must be invisible otherwise: the last command of a path, a
    // segment before a `Z`, and a segment before a new subpath all land exactly
    // where the document put them.
    expect(parseSvgPathData("M0 0 L3 4").commands[1]).toEqual({
      kind: "line",
      x: 3,
      y: 4,
    });
    expect(parseSvgPathData("M0 0 L3 4 Z").commands[1]).toEqual({
      kind: "line",
      x: 3,
      y: 4,
    });
    expect(parseSvgPathData("M0 0 L3 4 M9 9").commands[1]).toEqual({
      kind: "line",
      x: 3,
      y: 4,
    });
  });

  it("falls back to the chord when the arc is unresolvable in double precision", () => {
    // Radii enormous beside the chord: the two endpoint angles collapse onto
    // the same double. Without the fallback the sweep normalization would turn
    // a zero difference into a full turn of radius 10^20.
    expect(kinds(parseSvgPathData("M0 0 A1e20 1e20 0 0 1 1 0"))).toEqual([
      "move",
      "line",
    ]);
    // The other collapse: a chord so small that its half squares to zero.
    expect(kinds(parseSvgPathData("M0 0 A1 1 0 0 1 1e-200 0"))).toEqual([
      "move",
      "line",
    ]);
  });

  it("reads a relative arc against the current point", () => {
    const relative = parseSvgPathData("M10 10 a5 5 0 0 1 6 6");
    const absolute = parseSvgPathData("M10 10 A5 5 0 0 1 16 16");
    expect(relative.commands).toEqual(absolute.commands);
  });

  it("repeats arc argument sets", () => {
    const path = parseSvgPathData("M0 0 A5 5 0 0 1 6 6 5 5 0 0 1 12 0");
    expect(kinds(path)).toEqual(["move", "arc", "arc"]);
  });
});

describe("parseSvgPathData — refusals (§85)", { timeout: 30_000 }, () => {
  const refusals: readonly (readonly [string, string])[] = [
    ["L 1 1", "must begin with a moveto"],
    ["Z", "must begin with a moveto"],
    ["1 2", "must begin with a moveto"],
    ["M 0 0 X 1 1", "expected a path command letter"],
    ["M 0 0 B 90", "expected a path command letter"],
    ["M 0 0 , L 1 1", "expected a path command letter"],
    ["M 0 0 L 1", "expected a number"],
    ["M 0 0 L", "expected a number"],
    ["M 0 0 L . 1", "expected a number"],
    ["M 0 0 L - 1", "expected a number"],
    ["M 0 0 L 1,,2", "expected a number"],
    ["M 0 0 L 1e 2", "an exponent must carry at least one digit"],
    ["M 0 0 L 1e+ 2", "an exponent must carry at least one digit"],
    ["M 1e999 0", "overflows to infinity"],
    ["M 0 0 A 1 1 0 2 1 1 1", "an arc flag must be exactly"],
    ["M 0 0 A 1 1 0 1", "an arc flag must be exactly"],
    ["M 0 0 A 1 1 0 0 1 1e200 0", "centre parameterization overflows"],
  ];

  for (const [source, fragment] of refusals) {
    it(`refuses ${JSON.stringify(source)}`, () => {
      expect(() => parseSvgPathData(source)).toThrow(SyntaxError);
      expect(() => parseSvgPathData(source)).toThrow(fragment);
    });
  }

  it("names the offset, and the end of the input when it ran out", () => {
    expect(() => parseSvgPathData("M 0 0 X")).toThrow("at offset 6");
    expect(() => parseSvgPathData("M 0 0 L")).toThrow("the end of the input");
  });

  it("keeps nothing from a path that failed half way", () => {
    // SVG viewers render up to the error; an importer must not (§85).
    let thrown: unknown;
    try {
      parseSvgPathData("M0 0 L1 1 L2 2 QQ");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyntaxError);
  });

  it("refuses a non-string, which is how a `d` arrives from JSON", () => {
    expect(() => parseSvgPathData(null as unknown as string)).toThrow(
      SyntaxError,
    );
    expect(() => parseSvgPathData(42 as unknown as string)).toThrow(
      "must be a string",
    );
  });
});

describe(
  "parseSvgPathData — untrusted input (§96)",
  { timeout: 30_000 },
  () => {
    it("refuses text longer than the limit, naming the policy that fired", () => {
      const data = `M0 0${" L1 1".repeat(20)}`;
      let thrown: FourError | undefined;
      try {
        parseSvgPathData(data, { maximumTextLength: 8 });
      } catch (error) {
        thrown = error as FourError;
      }
      expect(thrown).toBeInstanceOf(FourError);
      expect(thrown?.code).toBe("UNTRUSTED_INPUT_REJECTED");
      expect(thrown?.context).toEqual({
        limitName: "maximumTextLength",
        limit: 8,
        observed: data.length,
      });
    });

    it("has a finite default, and an explicit in-source opt-out", () => {
      expect(Number.isFinite(DEFAULT_MAXIMUM_PATH_DATA_LENGTH)).toBe(true);
      expect(
        parseSvgPathData("M0 0 L1 1", {
          maximumTextLength: Number.POSITIVE_INFINITY,
        }).commands,
      ).toHaveLength(2);
      expect(parseSvgPathData("M0 0", { maximumTextLength: 4 }).isEmpty).toBe(
        false,
      );
    });

    it("refuses a limit that is not a positive number", () => {
      for (const limit of [0, -1, Number.NaN]) {
        expect(() =>
          parseSvgPathData("M0 0", { maximumTextLength: limit }),
        ).toThrow(RangeError);
      }
    });
  },
);

describe("formatSvgPathData", { timeout: 30_000 }, () => {
  it("writes every command kind, absolute and uppercase", () => {
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(10, 0)
      .quadraticCurveTo(15, 5, 10, 10)
      .cubicCurveTo(7.5, 12.5, 2.5, 12.5, 0, 10)
      .close();
    expect(formatSvgPathData(path)).toBe(
      "M 0 0 L 10 0 Q 15 5 10 10 C 7.5 12.5 2.5 12.5 0 10 Z",
    );
  });

  it("writes an empty path as an empty string", () => {
    expect(formatSvgPathData(new Path())).toBe("");
  });

  it("writes §51's implicit connecting segment as an explicit lineto", () => {
    // A rounded corner: an `arc` whose start is not the current point.
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(10, 0)
      .arc(10, 5, 5, -Math.PI / 2, 0);
    const written = formatSvgPathData(path);
    expect(written.startsWith("M 0 0 L 10 0 A ")).toBe(true);
    // No spurious lineto when the arc already starts where the cursor is.
    const flush = new Path().arc(0, 0, 5, 0, Math.PI / 2);
    expect(formatSvgPathData(flush).split("L")).toHaveLength(1);
  });

  it("splits a full turn into two `A` commands, because SVG cannot write one", () => {
    const circle = new Path().arc(0, 0, 4, 0, Math.PI * 2);
    const written = formatSvgPathData(circle);
    expect(written.split("A")).toHaveLength(3);
    // Two half turns: neither needs the large-arc flag.
    expect(written).toContain("A 4 4 0 0 1 ");
    expect(kinds(parseSvgPathData(written))).toEqual(["move", "arc", "arc"]);
  });

  it("writes the large-arc flag for a sweep past a half turn", () => {
    const major = new Path().arc(0, 0, 4, 0, Math.PI * 1.5);
    expect(formatSvgPathData(major)).toContain(" 1 1 ");
    const minor = new Path().arc(0, 0, 4, 0, Math.PI * 0.5);
    expect(formatSvgPathData(minor)).toContain(" 0 1 ");
    // §51's `counterclockwise` is what makes a sweep negative — `arc(…, 0, −π/2)`
    // without it is Canvas's *three quarters the other way* (see `Path.arc`).
    const clockwise = new Path().arc(0, 0, 4, 0, -Math.PI * 0.5, true);
    expect(formatSvgPathData(clockwise)).toContain(" 0 0 ");
  });

  it("writes a zero-sweep arc as nothing, because that is what it draws", () => {
    // The builder's own `moveTo` to the arc's first point survives; the arc
    // itself contributes no `A`, which is exactly what it paints.
    const nothing = new Path().arc(0, 0, 4, 1, 1);
    expect(formatSvgPathData(nothing).startsWith("M ")).toBe(true);
    expect(formatSvgPathData(nothing)).not.toContain("A");
  });

  it("writes the ellipse rotation back in degrees", () => {
    const path = new Path().ellipse(0, 0, 20, 10, Math.PI / 4, 0, Math.PI / 2);
    expect(formatSvgPathData(path)).toContain(" 20 10 45 0 1 ");
  });

  it("writes negative zero as zero, which is JavaScript's decision", () => {
    // `String(-0)` is `"0"`. Geometrically nothing moves; it is stated because
    // it is the one way the otherwise exact round trip is not bit-identical.
    expect(formatSvgPathData(parseSvgPathData("M -0 0 L -0.0 1"))).toBe(
      "M 0 0 L 0 1",
    );
  });

  it("keeps the default output identical when options are omitted", () => {
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(10, 0)
      .quadraticCurveTo(15, 5, 10, 10)
      .cubicCurveTo(7.5, 12.5, 2.5, 12.5, 0, 10)
      .close();
    expect(formatSvgPathData(path, {})).toBe(formatSvgPathData(path));
    expect(formatSvgPathData(path)).toBe(
      "M 0 0 L 10 0 Q 15 5 10 10 C 7.5 12.5 2.5 12.5 0 10 Z",
    );
  });

  it("rounds to a supplied precision without changing the default path", () => {
    const path = new Path().moveTo(1.23456, 7.891).lineTo(0.001, -2.6);
    expect(formatSvgPathData(path, { precision: 2 })).toBe(
      "M 1.23 7.89 L 0 -2.6",
    );
    expect(formatSvgPathData(path, { precision: 0 })).toBe("M 1 8 L 0 -3");
    const arc = new Path().arc(0, 0, 4, 0, Math.PI / 2);
    expect(formatSvgPathData(arc, { precision: 3 })).toContain("A 4 4");
  });

  it("refuses a precision that is not an integer in 0…20", () => {
    const path = new Path().moveTo(0, 0);
    expect(() => formatSvgPathData(path, { precision: 1.5 })).toThrow(
      /precision/,
    );
    expect(() => formatSvgPathData(path, { precision: -1 })).toThrow(
      RangeError,
    );
    expect(() => formatSvgPathData(path, { precision: 21 })).toThrow(
      RangeError,
    );
  });
});

describe("round trips", { timeout: 30_000 }, () => {
  const withoutArcs = [
    "M 0 0 L 10 0 L 10 10 L 0 10 Z",
    "M 0 0 C 0 -6 10 -6 10 0 C 10 6 0 10 0 16",
    "M 0 0 Q 5 5 10 0 T 20 0 Z",
    "M 1.5 -2.25 L 1e-7 3 L 123456789.0625 0",
    "M 0 0 L 1 1 Z L 2 2 Z",
  ];

  it("is an exact identity on the command list for paths without arcs", () => {
    for (const source of withoutArcs) {
      const once = parseSvgPathData(source);
      const twice = parseSvgPathData(formatSvgPathData(once));
      expect(twice.commands, source).toEqual(once.commands);
      // And the text is a fixed point after one normalization pass.
      expect(formatSvgPathData(twice), source).toBe(formatSvgPathData(once));
    }
  });

  it("preserves an arc's shape to within ulps — but not its sample count", () => {
    for (const source of [
      "M 100 0 A 100 100 0 0 1 0 100",
      "M 0 0 A 30 20 30 1 0 40 10",
      "M 0 0 A 5 5 0 1 1 6 6 A 5 5 0 0 0 0 0",
    ]) {
      const once = parseSvgPathData(source);
      const twice = parseSvgPathData(formatSvgPathData(once));
      // Deliberately *not* a point-for-point comparison: an arc's sample count
      // comes from `Math.acos` and a `Math.ceil`, so a last-bit difference in
      // the recovered sweep is allowed to move it by one. The shape is the
      // claim, so the shape is what is measured — the same arc-length
      // parameter must land within a nanometre on both.
      expect(twice.length(0.01), source).toBeCloseTo(once.length(0.01), 9);
      for (let step = 0; step <= 8; step += 1) {
        const t = step / 8;
        const before = once.pointAt(t, 0.01);
        const after = twice.pointAt(t, 0.01);
        expect(after.x, source).toBeCloseTo(before.x, 9);
        expect(after.y, source).toBeCloseTo(before.y, 9);
      }
    }
  });

  it("survives every path §51's own builder can produce", () => {
    const built = new Path()
      .moveTo(-3, 7)
      .lineTo(4, 7)
      .quadraticCurveTo(9, 7, 9, 2)
      .cubicCurveTo(9, -3, 4, -3, -3, -3)
      .arc(-3, 2, 5, -Math.PI / 2, Math.PI / 2, true)
      .close();
    const read = parseSvgPathData(formatSvgPathData(built));
    // One command more than the original, and it is not a defect: §51's arc
    // carries an *implicit* segment from the current point to its own first
    // point, and here those differ by 3 × 10⁻¹⁶ (`cos(−π/2)` is not exactly
    // zero). SVG has no implicit segment, so the writer makes it explicit.
    expect(kinds(read)).toEqual([
      "move",
      "line",
      "quadratic",
      "cubic",
      "line",
      "arc",
      "close",
    ]);
    expect(read.length(0.01)).toBeCloseTo(built.length(0.01), 6);
  });
});

describe(
  "the Y axis is transcribed, not flipped (§7a)",
  { timeout: 30_000 },
  () => {
    it("keeps SVG's numbers, so imported content is mirrored until it is not", () => {
      const path = parseSvgPathData("M 0 0 L 10 20");
      expect(path.commands[1]).toEqual({ kind: "line", x: 10, y: 20 });
    });

    it("lands SVG content in a Y-up world in one exact transform", () => {
      // The documented one-liner: y ↦ height − y, column-major.
      const height = 100;
      const svgToWorld = new Matrix3().fromArray([
        1,
        0,
        0,
        0,
        -1,
        0,
        0,
        height,
        1,
      ]);
      const world = parseSvgPathData(
        "M 0 0 L 10 20 A 5 5 0 0 1 30 20",
      ).transform(svgToWorld);
      expect(world.commands[0]).toEqual({ kind: "move", x: 0, y: 100 });
      expect(world.commands[1]).toEqual({ kind: "line", x: 10, y: 80 });
      // A reflection is a similarity, so the arc survives it (§51).
      expect(world.commands[2].kind).toBe("arc");
      // Negation is exact: the flip loses nothing and is its own inverse.
      const back = world.transform(svgToWorld);
      expect(back.commands[1]).toEqual({ kind: "line", x: 10, y: 20 });
    });
  },
);

describe("hostile input is total (§96)", { timeout: 30_000 }, () => {
  /** The three error types the module documents, and nothing else. */
  function classify(error: unknown): string {
    if (error instanceof SyntaxError) {
      return "syntax";
    }
    if (error instanceof RangeError) {
      return "range";
    }
    if (error instanceof Error && error.name === "FourError") {
      return "policy";
    }
    return `unexpected: ${String(error)}`;
  }

  /**
   * Parses, and asserts the only two legal outcomes: a path that survives a
   * further export/import cycle, or one of the documented errors.
   */
  function probe(source: string): string {
    let path: Path;
    try {
      path = parseSvgPathData(source);
    } catch (error) {
      return classify(error);
    }
    // A parse that succeeded must have produced something well formed: its
    // export must re-import, which is the strongest cheap check there is.
    const written = formatSvgPathData(path);
    expect(() => parseSvgPathData(written), source).not.toThrow();
    return "parsed";
  }

  it("never hangs, never throws anything undocumented, on random text", () => {
    const random = new SeededRandom(0x5f6c2a11);
    const alphabet =
      "MmLlHhVvCcSsQqTtAaZz0123456789.,+-eE \t\n\r\f()[]{}<>/*%$#@! ÿ";
    const outcomes = new Map<string, number>();
    for (let trial = 0; trial < 20_000; trial += 1) {
      const length = 1 + Math.floor(random.nextFloat01() * 24);
      let source = "";
      for (let index = 0; index < length; index += 1) {
        source += alphabet.charAt(
          Math.floor(random.nextFloat01() * alphabet.length),
        );
      }
      const outcome = probe(source);
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    }
    for (const key of outcomes.keys()) {
      expect(key, JSON.stringify([...outcomes])).toMatch(
        /^(syntax|range|policy|parsed)$/,
      );
    }
    // The corpus has to actually reach the parser, not bounce off `M` at once.
    expect(outcomes.get("parsed") ?? 0).toBeGreaterThan(50);
  });

  it("never hangs on mutations of valid paths", () => {
    const random = new SeededRandom(0x2b19d4e7);
    const seeds = [
      "M 0 0 L 10 0 L 10 10 Z",
      "M 0 0 C 1 2 3 4 5 6 S 7 8 9 10",
      "M 100 0 A 100 100 0 1 1 0 100 Z",
      "m 0 0 q 5 5 10 0 t 20 0 z",
      "M0 0h10v10h-10z",
    ];
    let parsed = 0;
    for (let trial = 0; trial < 10_000; trial += 1) {
      const seed = seeds[Math.floor(random.nextFloat01() * seeds.length)];
      const at = Math.floor(random.nextFloat01() * seed.length);
      const roll = random.nextFloat01();
      const source =
        roll < 0.34
          ? seed.slice(0, at) + seed.slice(at + 1)
          : roll < 0.67
            ? seed.slice(0, at) + "9e9" + seed.slice(at)
            : seed.slice(0, at) +
              seed.charAt(at).toUpperCase() +
              seed.slice(at);
      if (probe(source) === "parsed") {
        parsed += 1;
      }
    }
    expect(parsed).toBeGreaterThan(1_000);
  });

  it("is linear, not quadratic, on the shapes that break a backtracking parser", () => {
    // The classic ReDoS shapes. A regex-based number scanner with nested
    // quantifiers goes exponential here; a forward scan does not notice.
    for (const source of [
      `M0 0${"L1 1".repeat(20_000)}`,
      `M0 0 L${"9".repeat(50_000)} 1`,
      `M0 0 L1e${"9".repeat(20_000)}`,
      `M0 0${",".repeat(5_000)}`,
      `${" ".repeat(50_000)}M0 0`,
    ]) {
      expect(() => probe(source)).not.toThrow();
    }
  });
});
