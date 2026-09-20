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
