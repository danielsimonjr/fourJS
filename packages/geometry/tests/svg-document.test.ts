/**
 * Unit tests for §50's SVG document tier (`R-26`).
 *
 * The tokenizer is the contract: a tiny document with `viewBox`, a `rect`,
 * a `path`, and a grouped transform must come back as paths; `<!DOCTYPE`
 * must be refused. Everything else is coverage of the elements and
 * presentation attributes the owner listed.
 */

import { FourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH,
  formatSvgPathData,
  parseSvgDocument,
} from "../src/index.js";

describe("parseSvgDocument — the required document", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
      <rect x="10" y="10" width="20" height="10" fill="#abc" />
      <path d="M 0 0 L 8 0 L 8 8 Z" fill-rule="evenodd"/>
      <g transform="translate(50, 20)">
        <rect x="0" y="0" width="4" height="4" stroke="red"/>
      </g>
    </svg>
  `;

  it("reads viewBox, rect, path, and a group transform", () => {
    const doc = parseSvgDocument(svg);
    expect(doc.viewBox).toEqual({ minX: 0, minY: 0, width: 100, height: 50 });
    expect(doc.paths).toHaveLength(3);

    const [box, path, grouped] = doc.paths;
    expect(box.fill).toBe("#abc");
    expect(box.path.commands[0]).toEqual({ kind: "move", x: 10, y: 10 });
    expect(box.path.commands[1]).toEqual({ kind: "line", x: 30, y: 10 });
    expect(box.path.commands[2]).toEqual({ kind: "line", x: 30, y: 20 });
    expect(box.path.commands[3]).toEqual({ kind: "line", x: 10, y: 20 });
    expect(box.path.commands[4]).toEqual({ kind: "close" });

    expect(path.path.fillRule).toBe("even-odd");
    expect(formatSvgPathData(path.path)).toBe("M 0 0 L 8 0 L 8 8 Z");

    expect(grouped.stroke).toBe("red");
    expect(grouped.path.commands[0]).toEqual({ kind: "move", x: 50, y: 20 });
    expect(grouped.path.commands[1]).toEqual({ kind: "line", x: 54, y: 20 });
  });

  it("transcribes Y, leaving the viewBox flip to the caller", () => {
    const doc = parseSvgDocument(svg);
    expect(doc.paths[0].path.commands[0]).toMatchObject({ y: 10 });
    expect(doc.viewBox?.height).toBe(50);
  });
});

describe("parseSvgDocument — §96 refusals", () => {
  it("refuses <!DOCTYPE", () => {
    expect(() =>
      parseSvgDocument(
        `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://x"><svg/>`,
      ),
    ).toThrow(FourError);
    try {
      parseSvgDocument("<!doctype html><svg></svg>");
    } catch (error) {
      expect(error).toBeInstanceOf(FourError);
      expect((error as FourError).code).toBe("UNTRUSTED_INPUT_REJECTED");
    }
  });

  it("refuses <!ENTITY and other markup declarations", () => {
    expect(() =>
      parseSvgDocument(`<!ENTITY x SYSTEM "file:///etc/passwd"><svg/>`),
    ).toThrow(/entity/i);
    expect(() => parseSvgDocument(`<![CDATA[x]]><svg/>`)).toThrow(
      /markup declarations/,
    );
  });

  it("refuses unknown entity references in attributes", () => {
    expect(() =>
      parseSvgDocument(`<svg><rect width="&ext;" height="1"/></svg>`),
    ).toThrow(/entity/i);
  });

  it("refuses a document over the size limit", () => {
    expect(() =>
      parseSvgDocument("<svg></svg>", { maximumTextLength: 4 }),
    ).toThrow(FourError);
    expect(Number.isFinite(DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH)).toBe(true);
  });

  it("refuses a non-string and a non-positive limit", () => {
    expect(() => parseSvgDocument(null as unknown as string)).toThrow(
      /must be a string/,
    );
    expect(() => parseSvgDocument("<svg/>", { maximumTextLength: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("parseSvgDocument — elements and presentation", () => {
  it("reads circle, ellipse, line, polyline, and polygon", () => {
    const doc = parseSvgDocument(`
      <svg>
        <circle cx="2" cy="3" r="4"/>
        <ellipse cx="0" cy="0" rx="5" ry="2"/>
        <line x1="0" y1="0" x2="1" y2="1"/>
        <polyline points="0,0 1,0 1,1"/>
        <polygon points="0 0 2 0 1 1"/>
      </svg>
    `);
    expect(doc.paths).toHaveLength(5);
    expect(doc.paths[0].path.commands.some((c) => c.kind === "arc")).toBe(true);
    expect(doc.paths[2].path.commands).toEqual([
      { kind: "move", x: 0, y: 0 },
      { kind: "line", x: 1, y: 1 },
    ]);
    expect(doc.paths[3].path.commands.map((c) => c.kind)).toEqual([
      "move",
      "line",
      "line",
    ]);
    expect(doc.paths[4].path.commands.at(-1)?.kind).toBe("close");
  });

  it("applies translate, rotate, scale, and matrix", () => {
    const translated = parseSvgDocument(
      `<svg><rect x="0" y="0" width="1" height="1" transform="translate(10 5)"/></svg>`,
    );
    expect(translated.paths[0].path.commands[0]).toEqual({
      kind: "move",
      x: 10,
      y: 5,
    });

    const scaled = parseSvgDocument(
      `<svg><rect x="1" y="1" width="1" height="1" transform="scale(2)"/></svg>`,
    );
    expect(scaled.paths[0].path.commands[0]).toEqual({
      kind: "move",
      x: 2,
      y: 2,
    });

    const matrix = parseSvgDocument(
      `<svg><rect x="0" y="0" width="1" height="1" transform="matrix(1 0 0 1 3 4)"/></svg>`,
    );
    expect(matrix.paths[0].path.commands[0]).toEqual({
      kind: "move",
      x: 3,
      y: 4,
    });

    const rotated = parseSvgDocument(
      `<svg><g transform="rotate(90)"><line x1="1" y1="0" x2="1" y2="0"/></g></svg>`,
    );
    const move = rotated.paths[0].path.commands[0];
    expect(move.kind).toBe("move");
    if (move.kind === "move") {
      expect(move.x).toBeCloseTo(0, 9);
      expect(move.y).toBeCloseTo(1, 9);
    }
  });

  it("rotates about a centre and inherits fill / stroke / fill-rule", () => {
    const doc = parseSvgDocument(`
      <svg fill="black" stroke="none" fill-rule="evenodd">
        <g fill="blue" transform="rotate(0 2 2)">
          <rect x="2" y="2" width="1" height="1" stroke="green"/>
        </g>
      </svg>
    `);
    expect(doc.paths[0].fill).toBe("blue");
    expect(doc.paths[0].stroke).toBe("green");
    expect(doc.paths[0].path.fillRule).toBe("even-odd");
  });

  it("skips defs, comments, xml declarations, and display:none", () => {
    const doc = parseSvgDocument(`
      <?xml version="1.0"?>
      <svg>
        <!-- a comment -->
        <defs><rect x="0" y="0" width="9" height="9"/></defs>
        <title>ignored</title>
        <rect x="1" y="1" width="1" height="1" display="none"/>
        <rect x="2" y="2" width="1" height="1"/>
      </svg>
    `);
    expect(doc.paths).toHaveLength(1);
    expect(doc.paths[0].path.commands[0]).toMatchObject({ x: 2, y: 2 });
  });

  it("walks unknown wrappers and namespaced names", () => {
    const doc = parseSvgDocument(
      `<svg><foo><svg:rect x="1" y="2" width="3" height="4"/></foo></svg>`,
    );
    expect(doc.paths).toHaveLength(1);
    expect(doc.paths[0].path.commands[0]).toEqual({
      kind: "move",
      x: 1,
      y: 2,
    });
  });

  it("decodes predefined and numeric entities in attributes", () => {
    const doc = parseSvgDocument(
      `<svg><rect x="0" y="0" width="1" height="1" fill="&quot;pink&quot;"/></svg>`,
    );
    expect(doc.paths[0].fill).toBe('"pink"');
    const numbered = parseSvgDocument(
      `<svg><rect x="0" y="0" width="1" height="1" fill="&#35;fff"/></svg>`,
    );
    expect(numbered.paths[0].fill).toBe("#fff");
  });

  it("skips zero-size shapes and empty path data", () => {
    const doc = parseSvgDocument(`
      <svg>
        <rect x="0" y="0" width="0" height="1"/>
        <circle r="0"/>
        <ellipse rx="1" ry="0"/>
        <path d=""/>
        <polygon points=""/>
        <rect x="0" y="0" width="1" height="1"/>
      </svg>
    `);
    expect(doc.paths).toHaveLength(1);
  });

  it("parses viewBox with commas and a missing viewBox as undefined", () => {
    expect(
      parseSvgDocument(`<svg viewBox="1,2,3,4"><line/></svg>`).viewBox,
    ).toEqual({ minX: 1, minY: 2, width: 3, height: 4 });
    expect(parseSvgDocument(`<svg></svg>`).viewBox).toBeUndefined();
  });

  it("flattens a circle under a non-similarity scale rather than refusing", () => {
    const doc = parseSvgDocument(
      `<svg><circle cx="0" cy="0" r="1" transform="scale(2 1)"/></svg>`,
    );
    expect(doc.paths).toHaveLength(1);
    expect(doc.paths[0].path.commands.some((c) => c.kind === "line")).toBe(
      true,
    );
  });
});

describe("parseSvgDocument — syntax refusals", () => {
  it("refuses an unterminated comment and start tag", () => {
    expect(() => parseSvgDocument("<svg><!-- oops")).toThrow(
      /unterminated comment/,
    );
    expect(() => parseSvgDocument("<svg><rect")).toThrow(
      /unterminated start tag/,
    );
  });

  it("refuses unquoted attributes and unknown transforms", () => {
    expect(() => parseSvgDocument(`<svg><rect x=1 /></svg>`)).toThrow(/quoted/);
    expect(() =>
      parseSvgDocument(
        `<svg><rect transform="skewX(10)" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/unsupported transform/);
  });

  it("refuses a bad viewBox and negative rect size", () => {
    expect(() => parseSvgDocument(`<svg viewBox="1 2"><rect/></svg>`)).toThrow(
      /viewBox/,
    );
    expect(() =>
      parseSvgDocument(`<svg><rect width="-1" height="1"/></svg>`),
    ).toThrow(/non-negative/);
  });

  it("refuses transform arity errors, exponents without digits, and bad numbers", () => {
    expect(() =>
      parseSvgDocument(
        `<svg><rect transform="translate()" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/translate/);
    expect(() =>
      parseSvgDocument(
        `<svg><rect transform="scale()" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/scale/);
    expect(() =>
      parseSvgDocument(
        `<svg><rect transform="rotate(1 2)" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/rotate/);
    expect(() =>
      parseSvgDocument(
        `<svg><rect transform="matrix(1 2 3)" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/matrix/);
    expect(() =>
      parseSvgDocument(
        `<svg><rect transform="translate(1e)" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/exponent/);
    expect(() =>
      parseSvgDocument(
        `<svg><rect transform="translate(.)" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/transform number/);
  });

  it("refuses missing '=', '<' in values, and unterminated quotes / PI", () => {
    expect(() => parseSvgDocument(`<svg><rect x /></svg>`)).toThrow(
      /missing a value/,
    );
    expect(() => parseSvgDocument(`<svg><rect x="1<2"/></svg>`)).toThrow(
      /not allowed/,
    );
    expect(() => parseSvgDocument(`<svg><rect x="1`)).toThrow(
      /unterminated attribute/,
    );
    expect(() => parseSvgDocument(`<?xml version="1.0"`)).toThrow(
      /processing instruction/,
    );
    expect(() => parseSvgDocument(`<svg></svg extra>`)).toThrow(/expected '>'/);
  });

  it("refuses negative radii, odd point lists, and bad character references", () => {
    expect(() => parseSvgDocument(`<svg><circle r="-1"/></svg>`)).toThrow(
      /non-negative/,
    );
    expect(() =>
      parseSvgDocument(`<svg><ellipse rx="-1" ry="1"/></svg>`),
    ).toThrow(/non-negative/);
    expect(() =>
      parseSvgDocument(`<svg><polygon points="0 0 1"/></svg>`),
    ).toThrow(/pairs/);
    expect(() =>
      parseSvgDocument(`<svg><rect fill="&#;" width="1" height="1"/></svg>`),
    ).toThrow(/character reference/);
    expect(() =>
      parseSvgDocument(
        `<svg><rect fill="&#x110000;" width="1" height="1"/></svg>`,
      ),
    ).toThrow(/invalid numeric/);
  });
});

describe("parseSvgDocument — more transform and entity coverage", () => {
  it("accepts translate(tx), scale(sx sy), rotate about a centre, and exponents", () => {
    const one = parseSvgDocument(
      `<svg><rect x="0" y="0" width="1" height="1" transform="translate(5)"/></svg>`,
    );
    expect(one.paths[0].path.commands[0]).toEqual({ kind: "move", x: 5, y: 0 });

    const two = parseSvgDocument(
      `<svg><rect x="1" y="1" width="1" height="1" transform="scale(2, 3)"/></svg>`,
    );
    expect(two.paths[0].path.commands[0]).toEqual({ kind: "move", x: 2, y: 3 });

    const about = parseSvgDocument(
      `<svg><rect x="2" y="1" width="0" height="0" transform="rotate(180 2 1)"/><rect x="3" y="1" width="1" height="1" transform="rotate(180 3 1)"/></svg>`,
    );
    expect(about.paths).toHaveLength(1);
    const move = about.paths[0].path.commands[0];
    expect(move.kind).toBe("move");
    if (move.kind === "move") {
      expect(move.x).toBeCloseTo(3, 9);
      expect(move.y).toBeCloseTo(1, 9);
    }

    const exp = parseSvgDocument(
      `<svg><rect x="0" y="0" width="1" height="1" transform="translate(1e1 -2E0)"/></svg>`,
    );
    expect(exp.paths[0].path.commands[0]).toEqual({
      kind: "move",
      x: 10,
      y: -2,
    });
  });

  it("decodes amp/lt/gt/apos and hex numeric entities", () => {
    const doc = parseSvgDocument(
      `<svg><rect width="1" height="1" fill="&amp;&lt;&gt;&apos;&#x23;"/></svg>`,
    );
    expect(doc.paths[0].fill).toBe("&<>'#");
  });

  it("honours fill-rule spellings and an empty transform list", () => {
    const even = parseSvgDocument(
      `<svg><path d="M0 0 L1 0 L0 1 Z" fill-rule="even-odd" transform="  "/></svg>`,
    );
    expect(even.paths[0].path.fillRule).toBe("even-odd");
    const non = parseSvgDocument(
      `<svg><path d="M0 0 L1 0 L0 1 Z" fill-rule="non-zero"/></svg>`,
    );
    expect(non.paths[0].path.fillRule).toBe("nonzero");
  });

  it("accepts a self-closing svg and an infinite size opt-out", () => {
    const doc = parseSvgDocument(`<svg viewBox="0 0 1 1"/>`, {
      maximumTextLength: Number.POSITIVE_INFINITY,
    });
    expect(doc.paths).toHaveLength(0);
    expect(doc.viewBox).toEqual({ minX: 0, minY: 0, width: 1, height: 1 });
  });
});
