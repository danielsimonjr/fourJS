/**
 * Tests for the shared code scanner in `strip-comments.mjs`.
 *
 * `strippedOfComments` is already exercised through
 * `apply-publish-names.test.mjs`, which is where it was born. These cover
 * `blankedCommentsAndStrings`, added for the dependency-graph generator's hand
 * brace-matcher, and the three quote-and-comment blind spots in that generator
 * that cycle 9 left filed: a JSDoc mention counted as a live reference, a name
 * in a comment counted as a delegation edge, and a brace inside a string
 * counted by the brace matcher.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  blankedCommentsAndStrings,
  strippedOfComments,
} from "./strip-comments.mjs";

/** The generator's `inFileRefs` counter, over whatever text it is given. */
const referenceCount = (text, name) =>
  (text.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;

/** The generator's brace matcher, over whatever text it is given to scan. */
const matchBraces = (source, scan, start) => {
  let depth = 0;
  for (let i = start; i < scan.length; i++) {
    if (scan[i] === "{") depth++;
    else if (scan[i] === "}" && --depth === 0)
      return source.slice(start, i + 1);
  }
  return source.slice(start);
};

test("blankedCommentsAndStrings preserves length and every offset", () => {
  const source = [
    "const a = { x: 1 }; // trailing { comment",
    "/* block } comment */",
    'const b = "a } string";',
    "const c = `tpl } ${ inner } tail`;",
  ].join("\n");
  const blanked = blankedCommentsAndStrings(source);
  assert.equal(blanked.length, source.length);
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") assert.equal(blanked[i], "\n");
  }
  // Code outside the blanked bodies is untouched.
  assert.ok(blanked.startsWith("const a = { x: 1 }; "));
  // A `${ … }` expression is code and survives; the literal text does not.
  assert.ok(blanked.includes("${ inner }"));
  assert.ok(!blanked.includes("tail"));
  assert.ok(!blanked.includes("a } string"));
  assert.ok(!blanked.includes("trailing"));
});

test("a brace inside a string no longer ends the block early", () => {
  // The real shape: an object literal whose first property value is a message
  // carrying an unbalanced brace. Counting raw `{`/`}` stops at that brace.
  const source = 'f({ note: "ends here }", dispatch: fooDispatch });';
  const start = source.indexOf("{");
  const naive = matchBraces(source, source, start);
  const fixed = matchBraces(source, blankedCommentsAndStrings(source), start);

  // RED before the fix: the naive scan closes at the brace inside the string,
  // so `fooDispatch` falls outside the block and the entry reads as js-only.
  assert.equal(naive, '{ note: "ends here }');
  assert.ok(!naive.includes("fooDispatch"));

  // GREEN: the block is the real object literal, and the dispatch is inside it.
  assert.equal(fixed, '{ note: "ends here }", dispatch: fooDispatch }');
  assert.ok(fixed.includes("fooDispatch"));
});

test("a brace inside a template literal no longer ends the block early", () => {
  const source = "f({ note: `depth ${n} of {`, dispatch: barDispatch });";
  const start = source.indexOf("{");
  const fixed = matchBraces(source, blankedCommentsAndStrings(source), start);
  assert.ok(fixed.includes("barDispatch"));
  assert.ok(fixed.endsWith("barDispatch }"));
});

test("a JSDoc mention is not a live in-file reference", () => {
  const source = [
    "/**",
    " * Superseded by {@link widen}; see `widen` for the shipped form.",
    " */",
    "export function widen(): void {}",
  ].join("\n");

  // RED before the fix: two prose mentions read as two live references, so an
  // export with no caller at all reports `inFileRefs: 2` and is filed as a
  // type contract rather than a deletion candidate.
  assert.equal(referenceCount(source, "widen"), 3);

  // GREEN: only the definition itself remains, which the caller subtracts.
  assert.equal(referenceCount(strippedOfComments(source), "widen"), 1);
});

test("a name in a comment is not a delegation edge", () => {
  const body = [
    "function besselJDispatch() {",
    "  // Used to delegate to besselOrderDispatch; now inlined.",
    "  return 0;",
    "}",
  ].join("\n");

  // RED before the fix: the comment alone makes the delegation scan mark this
  // dispatch as reaching the AssemblyScript path through a callee it no longer
  // calls, so a js-fallback entry is reported as wasm.
  assert.ok(body.includes("besselOrderDispatch"));

  // GREEN.
  assert.ok(!strippedOfComments(body).includes("besselOrderDispatch"));
});
