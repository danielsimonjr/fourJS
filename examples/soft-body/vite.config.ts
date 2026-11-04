import { defineConfig } from "vite";

export default defineConfig({
  // §85 build mode (A-4, 2026-08-07). The examples are what `bun run size`
  // measures against §86's payload budget, so they build the way a shipped
  // application should: `__FOUR_DEV__: "false"` makes `@fourjs/core`'s `DEV` a
  // literal `false`, and every author-facing path guarded by it — §84's
  // statistics wiring, §6a's duplicate-component warning, §83's leak audit —
  // becomes dead code the tree-shaker deletes. Leave the define out (or set it
  // to `"true"`) to get the warnings back; that is the default for anyone who
  // does not configure it. See docs/guides/performance-optimization.md.
  define: { __FOUR_DEV__: "false" },
  build: {
    outDir: "dist",
  },
});
