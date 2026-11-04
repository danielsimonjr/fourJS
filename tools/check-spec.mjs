#!/usr/bin/env node
// Mechanical consistency checks for docs/SPECIFICATION.md.
// Usage: node tools/check-spec.mjs   (exit 0 = clean, 1 = violations)
// Intended to become the docs job of the Phase 0 CI workflow (§103).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "docs", "SPECIFICATION.md");
const text = readFileSync(specPath, "utf8");
const lines = text.split("\n");
const errors = [];

// 1. Section headings: 1..120 each exactly once, in order; only the known
//    lettered insertions allowed. § numbering is frozen (revision 1.1 rule).
const ALLOWED_LETTERED = new Set([
  "35a",
  "6a",
  "6b",
  "7a",
  "7b",
  "60a",
  "77a",
  "97a",
  "106a",
  "113a",
  "113b",
]);
const headings = [];
lines.forEach((line, i) => {
  const m = line.match(/^### (\d+[a-z]?)\. /);
  if (m) headings.push({ id: m[1], line: i + 1 });
});
const numeric = headings
  .filter((h) => /^\d+$/.test(h.id))
  .map((h) => Number(h.id));
for (let n = 1; n <= 120; n++) {
  const count = numeric.filter((x) => x === n).length;
  if (count !== 1)
    errors.push(`section ${n} appears ${count} times (expected 1)`);
}
headings
  .filter((h) => !/^\d+$/.test(h.id) && !ALLOWED_LETTERED.has(h.id))
  .forEach((h) =>
    errors.push(
      `line ${h.line}: unexpected lettered section "${h.id}" (frozen numbering: new sections need an owner decision)`,
    ),
  );
let prev = 0;
for (const h of headings) {
  const n = Number(h.id.match(/^\d+/)[0]);
  if (n < prev)
    errors.push(`line ${h.line}: section ${h.id} out of order (after ${prev})`);
  if (n > prev) prev = n;
}

// 2. Code fences balanced.
const fenceCount = lines.filter((l) => l.startsWith("```")).length;
if (fenceCount % 2 !== 0)
  errors.push(`unbalanced code fences (${fenceCount} markers)`);

// 3. TOC lists all parts and appendices that exist in the body, and vice versa.
const bodyH2 = lines
  .map((l, i) => ({ l, i }))
  .filter(({ l }) => /^## (Part |Appendix )/.test(l))
  .map(({ l }) => l.slice(3).trim());
const toc = text.match(/<!-- toc -->[\s\S]*?<!-- \/toc -->/)?.[0] ?? "";
for (const h of bodyH2) {
  const anchor = h
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  if (!toc.includes(`(#${anchor})`))
    errors.push(`TOC missing entry for "${h}"`);
}

// 4. Banned pre-revision terms (resolved by revision 1.1; must not reappear).
const BANNED = [
  [
    /MotionAuthority/,
    "MotionAuthority enum was merged into TransformAuthority (§42)",
  ],
  [/motionAuthority/, "use transformAuthority"],
  [/\bmotion authority\b/i, "use transform authority"],
  [
    /syncToScene|syncFromScene/,
    "use syncSceneToSolver / syncSolverToScene (§37)",
  ],
  [/Vector2\(0, 9\.81\)/, "2D gravity is negative Y (§7a, §21)"],
  [/applyForce\(force: Vector3, point/, "use applyForceAtPoint (§23, §26)"],
  [
    /applyImpulse\(impulse: Vector3, point/,
    "use applyImpulseAtPoint (§23, §26)",
  ],
];
lines.forEach((line, i) => {
  for (const [re, why] of BANNED) {
    if (re.test(line)) errors.push(`line ${i + 1}: banned term ${re} — ${why}`);
  }
});

// 5. Every §-reference points at a section that exists.
const known = new Set(headings.map((h) => h.id));
const refRe = /§(\d+[a-z]?)/g;
lines.forEach((line, i) => {
  for (const m of line.matchAll(refRe)) {
    const id = m[1];
    const n = Number(id.match(/^\d+/)[0]);
    if (!known.has(id) && (n < 1 || n > 120)) {
      errors.push(`line ${i + 1}: reference §${id} matches no section`);
    } else if (/[a-z]$/.test(id) && !known.has(id)) {
      errors.push(
        `line ${i + 1}: reference §${id} matches no lettered section`,
      );
    }
  }
});

if (errors.length) {
  console.error(
    `check-spec: ${errors.length} problem(s) in docs/SPECIFICATION.md`,
  );
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `check-spec: OK (${headings.length} sections, ${fenceCount / 2} code blocks)`,
);
