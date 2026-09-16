#!/usr/bin/env node
// Converts docs/guides/*.md to self-contained HTML for the GitHub Pages
// artifact. Pages serves files; it does not render Markdown, which is why
// docs.yml did not copy the guides until this tool existed (2026-09-06).
//
// Usage:
//   bun tools/render-guides.mjs --out=_site/guides
//
// Deliberately tiny: no npm markdown dependency, no write into docs/guides/
// (those stay Markdown; HTML is a deploy-time artifact). The stylesheet
// matches website/index.html so the hosted guides and the index look like
// one site. Relative `*.md` links become `*.html`; links that leave
// docs/guides/ are rewritten to the GitHub blob so they still resolve.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const guidesDir = join(root, "docs", "guides");
const GITHUB_BLOB = "https://github.com/danielsimonjr/four.js/blob/main";

function readOutDir(argv) {
  const eq = argv.find((arg) => arg.startsWith("--out="));
  if (eq) return eq.slice("--out=".length);
  const flag = argv.indexOf("--out");
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1];
  return join(root, "_site", "guides");
}
const outDir = readOutDir(process.argv);

const SITE_CSS = `:root {
        color-scheme: light dark;
        --fg: #16181d;
        --muted: #5b6270;
        --bg: #ffffff;
        --rule: #dfe3ea;
        --link: #14539a;
        --code-bg: #f4f6f9;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --fg: #e6e8ec;
          --muted: #9aa1af;
          --bg: #14161a;
          --rule: #2b2f37;
          --link: #7fb2f0;
          --code-bg: #1c2027;
        }
      }
      body {
        margin: 0 auto;
        padding: 3rem 1.25rem 5rem;
        max-width: 46rem;
        background: var(--bg);
        color: var(--fg);
        font:
          16px/1.6 ui-sans-serif,
          system-ui,
          -apple-system,
          "Segoe UI",
          sans-serif;
      }
      h1 {
        margin: 0 0 0.25rem;
        font-size: 2rem;
      }
      h2 {
        margin: 2.5rem 0 0.75rem;
        padding-bottom: 0.35rem;
        border-bottom: 1px solid var(--rule);
        font-size: 1.15rem;
      }
      h3 {
        margin: 1.75rem 0 0.5rem;
        font-size: 1.05rem;
      }
      h4 {
        margin: 1.25rem 0 0.4rem;
        font-size: 1rem;
      }
      p.lede,
      .muted {
        color: var(--muted);
      }
      a {
        color: var(--link);
      }
      ul,
      ol {
        padding-left: 1.1rem;
      }
      li {
        margin: 0.4rem 0;
      }
      nav {
        margin: 0 0 2rem;
        font-size: 0.9rem;
      }
      nav a + a::before {
        content: " · ";
        color: var(--muted);
        margin: 0 0.15rem;
      }
      pre {
        overflow-x: auto;
        padding: 0.85rem 1rem;
        background: var(--code-bg);
        border: 1px solid var(--rule);
        border-radius: 6px;
        font:
          13px/1.5 ui-monospace,
          SFMono-Regular,
          Menlo,
          Consolas,
          monospace;
      }
      code {
        font-family:
          ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.9em;
      }
      :not(pre) > code {
        padding: 0.1em 0.35em;
        background: var(--code-bg);
        border-radius: 4px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.92rem;
        margin: 1rem 0;
      }
      th,
      td {
        border: 1px solid var(--rule);
        padding: 0.4rem 0.55rem;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: var(--code-bg);
      }
      blockquote {
        margin: 1rem 0;
        padding: 0.1rem 0 0.1rem 1rem;
        border-left: 3px solid var(--rule);
        color: var(--muted);
      }
      hr {
        border: 0;
        border-top: 1px solid var(--rule);
        margin: 2rem 0;
      }
      footer {
        margin-top: 3rem;
        padding-top: 1rem;
        border-top: 1px solid var(--rule);
        color: var(--muted);
        font-size: 0.9rem;
      }`;

/** Escapes text that will sit in an HTML text node or attribute. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Rewrites a Markdown href so it still works on Pages.
 * Same-folder `.md` → `.html`. Paths that leave `docs/guides/` go to GitHub.
 */
function rewriteHref(href) {
  if (
    /^(https?:|mailto:|#)/i.test(href) ||
    href.startsWith("//") ||
    href.startsWith("/")
  ) {
    return href;
  }
  const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
  const path = hash ? href.slice(0, href.indexOf("#")) : href;
  if (path.startsWith("../")) {
    const repoPath = `docs/${path.replace(/^\.\.\//, "")}`;
    return `${GITHUB_BLOB}/${repoPath}${hash}`;
  }
  if (path.endsWith(".md")) {
    return `${path.slice(0, -3)}.html${hash}`;
  }
  return href;
}

/** Inline Markdown → HTML (emphasis, code, links). Code spans are protected. */
function inline(text) {
  const slots = [];
  const protect = (html) => {
    const key = `\u0000${String(slots.length)}\u0000`;
    slots.push(html);
    return key;
  };
  let s = text.replace(/`([^`]+)`/g, (_, code) =>
    protect(`<code>${escapeHtml(code)}</code>`),
  );
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    protect(
      `<a href="${escapeHtml(rewriteHref(href.trim()))}">${inline(label)}</a>`,
    ),
  );
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // oxlint-disable-next-line no-control-regex -- slot placeholders are NUL-delimited by design
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/** First ATX heading, used as `<title>` and the page H1 we keep from the body. */
function firstHeading(markdown) {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : "fourJS guide";
}

/** A very small CommonMark-ish subset: ATX headings, fences, lists, tables. */
function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const isTableSep = (line) =>
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushParagraph();
      const lang = line.slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(
        `<pre><code${cls}>${escapeHtml(body.join("\n"))}\n</code></pre>`,
      );
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      flushParagraph();
      const level = line.match(/^#+/)[0].length;
      out.push(
        `<h${level}>${inline(line.replace(/^#{1,6}\s+/, ""))}</h${level}>`,
      );
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim()) && paragraph.length === 0) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushParagraph();
      const split = (row) =>
        row
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = split(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(split(lines[i]));
        i += 1;
      }
      const thead = `<tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr>`;
      const tbody = rows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`,
        )
        .join("");
      out.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    const ul = /^[-*]\s+/.exec(line);
    const ol = /^\d+\.\s+/.exec(line);
    if (ul || ol) {
      flushParagraph();
      const ordered = Boolean(ol);
      const tag = ordered ? "ol" : "ul";
      const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const anyItem = /^([-*]|\d+\.)\s+/;
      out.push(`<${tag}>`);
      while (i < lines.length && marker.test(lines[i])) {
        let item = lines[i].replace(marker, "");
        i += 1;
        // Wrapped list items continue on the next line without a new marker
        // (the house style in docs/guides/*.md).
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !anyItem.test(lines[i]) &&
          !/^#{1,6}\s/.test(lines[i]) &&
          !/^```/.test(lines[i]) &&
          !/^\|/.test(lines[i])
        ) {
          item += ` ${lines[i].trim()}`;
          i += 1;
        }
        out.push(`<li>${inline(item)}</li>`);
      }
      out.push(`</${tag}>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }
  flushParagraph();
  return out.join("\n");
}

function page({ title, sourceRel, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — fourJS</title>
    <style>
      ${SITE_CSS}
    </style>
  </head>
  <body>
    <nav>
      <a href="../">fourJS</a>
      <a href="./">Guides</a>
      <a href="${GITHUB_BLOB}/${sourceRel}">Markdown source</a>
    </nav>
    ${body}
    <footer>
      Hosted from <code>docs/guides/</code> by
      <code>tools/render-guides.mjs</code> on every Pages deploy. The
      Markdown on GitHub remains the editable source.
    </footer>
  </body>
</html>
`;
}

const files = readdirSync(guidesDir)
  .filter((name) => name.endsWith(".md"))
  .sort();

if (files.length === 0) {
  console.error("render-guides: no docs/guides/*.md files found");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const guideFiles = files.filter((name) => name !== "README.md");

for (const name of files) {
  const markdown = readFileSync(join(guidesDir, name), "utf8");
  const title = firstHeading(markdown);
  const htmlName =
    name === "README.md" ? "index.html" : name.replace(/\.md$/, ".html");
  const html = page({
    title,
    sourceRel: `docs/guides/${name}`,
    body: markdownToHtml(markdown),
  });
  writeFileSync(join(outDir, htmlName), html);
}

console.log(
  `render-guides: wrote ${String(files.length)} page(s) to ${outDir} ` +
    `(${String(guideFiles.length)} guide(s) + index)`,
);
