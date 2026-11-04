/**
 * One comment stripper, shared by every `tools/` check that inspects code.
 *
 * Two tools in this directory had grown the same blind spot from two
 * directions. `apply-publish-names.mjs` hunted workspace package names by
 * quote character (`"` and `'`, never a backtick), so a name inside a template
 * literal — which is how every runtime message is written — passed both the
 * rewriter and its own residue guard and shipped to consumers twice
 * (2026-09-13, 2026-09-19). `check-docs.mjs` read a documentation snippet's
 * lifecycle calls with bare regexes, so a commented-out `// app.start()`
 * satisfied its skip and the §45 guard reported nothing.
 *
 * Both are the same mistake: deciding what a piece of code *does* from a
 * pattern that a comment, or a quote character the pattern did not enumerate,
 * walks straight past. The fix in both cases is to ask the question against
 * code with the comments removed, and then to let the pattern be
 * quote-agnostic. Keeping the stripper in one place is what stops the next
 * tool from inventing a third copy with a third gap.
 *
 * A regex pass rather than a parser, deliberately and with a stated limit: the
 * inputs are `tsc`'s readable, non-minified ESM and short hand-written doc
 * fences, never minified or exotic source. It is used only by CHECKS — nothing
 * here ever produces shipped bytes — so its worst failure is a check that
 * reads one line differently from a compiler, not a corrupted artifact.
 *
 * Known limit, recorded rather than hidden: a `//` sequence inside a
 * multi-line template literal is stripped as though it began a line comment.
 * `[^:'"`\\]` before the `//` already spares `https://`, a `//` inside a
 * single-line string, and an escaped one; the multi-line case needs a real
 * tokenizer and has never occurred in this tree. It can only make a check
 * blind to a line, never make it fabricate a violation.
 *
 * @param {string} text Source or emitted code.
 * @returns {string} The same text with block and line comments removed.
 */
export function strippedOfComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

/**
 * The same text with every comment body and every string body replaced by
 * spaces, **offset for offset**, so an index into the result is an index into
 * the original.
 *
 * {@link strippedOfComments} answers "what does this code do"; this answers
 * "where is this character", which is what a scanner that walks a source by
 * index needs. The dependency-graph generator brace-matched an object literal
 * by counting `{` and `}` over raw source, so a brace inside a string or a
 * template literal — `` `${a} { b}` ``, a regex-ish message, a CSS snippet —
 * moved its depth counter and ended the block in the wrong place. Blanking the
 * bodies rather than deleting them is the whole point: the delimiters, the
 * newlines and every code character keep their positions, so the caller can
 * scan the blanked copy and slice the original.
 *
 * Unlike {@link strippedOfComments} this is a real (small) scanner, because an
 * index-preserving answer cannot be had from independent regexes. It tracks
 * line and block comments, `'` / `"` strings with escapes, and template
 * literals including nested `${ … }` expressions — whose contents ARE code and
 * are therefore left intact. Regular-expression literals are deliberately not
 * modelled: telling `/` division from a regex needs the parser's context, and a
 * brace inside a regex literal has never occurred in the sources these checks
 * read. That is a recorded limit, not an oversight.
 *
 * @param {string} text Source or emitted code.
 * @returns {string} Same length as `text`; comment and string bodies blanked.
 */
export function blankedCommentsAndStrings(text) {
  return scanBlanking(text, true);
}

/**
 * The same text with every comment body replaced by spaces, offset for
 * offset, and every string and template-literal body left intact.
 *
 * {@link strippedOfComments} is a pair of regexes that cannot tell a `/*`
 * inside a string from a comment opener, so a string such as `"dist/*"`
 * swallowed everything up to the next real `*\/` — including a quoted
 * workspace name a residue check had to see (review finding, 2026-11-04).
 * This is the scanner behind {@link blankedCommentsAndStrings} with string
 * blanking switched off, so a check that asks "is this quoted name in code"
 * sees the name and not the comment that merely mentions it.
 *
 * @param {string} text Source or emitted code.
 * @returns {string} Same length as `text`; comment bodies blanked.
 */
export function blankedComments(text) {
  return scanBlanking(text, false);
}

/**
 * @param {string} text
 * @param {boolean} blankStrings Whether string and template bodies are blanked too.
 * @returns {string}
 */
function scanBlanking(text, blankStrings) {
  const out = Array.from(text);
  const blank = (index) => {
    if (out[index] !== "\n") out[index] = " ";
  };
  const blankBody = blankStrings ? blank : () => {};
  // Each entry is a template literal we are inside; the number counts the
  // `{` depth of the `${ … }` expression currently open within it, or -1 when
  // no expression is open. That is what makes `` `${ {a:1} }` `` work.
  const templates = [];
  let index = 0;
  while (index < text.length) {
    const c = text[index];
    const next = text[index + 1];
    const inTemplateExpression =
      templates.length > 0 && templates[templates.length - 1] >= 0;
    const inTemplateBody = templates.length > 0 && !inTemplateExpression;

    if (!inTemplateBody && c === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") blank(index++);
      continue;
    }
    if (!inTemplateBody && c === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      while (index < stop) blank(index++);
      continue;
    }
    if (!inTemplateBody && (c === "'" || c === '"')) {
      index += 1; // Keep the opening quote in place.
      while (index < text.length && text[index] !== c) {
        if (text[index] === "\\") blankBody(index++);
        if (index < text.length) blankBody(index++);
      }
      index += 1; // Keep the closing quote in place.
      continue;
    }
    if (inTemplateBody) {
      if (c === "\\") {
        blankBody(index);
        blankBody(index + 1);
        index += 2;
        continue;
      }
      if (c === "$" && next === "{") {
        templates[templates.length - 1] = 1; // Expression opens at depth 1.
        index += 2;
        continue;
      }
      if (c === "`") {
        templates.pop();
        index += 1;
        continue;
      }
      blankBody(index++);
      continue;
    }
    if (c === "`") {
      templates.push(-1);
      index += 1;
      continue;
    }
    if (inTemplateExpression) {
      if (c === "{") templates[templates.length - 1] += 1;
      else if (c === "}") {
        templates[templates.length - 1] -= 1;
        if (templates[templates.length - 1] === 0) {
          templates[templates.length - 1] = -1; // Back into the template body.
        }
      }
    }
    index += 1;
  }
  return out.join("");
}
