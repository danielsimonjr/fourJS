import { defineConfig } from "vite";

export default defineConfig({
  // §85 build mode (A-4, 2026-08-07). **This example deliberately does NOT set
  // `__FOUR_DEV__: "false"`**, which is the one place it departs from
  // `examples/flagship/one-scene-everything-moves` and every other example that
  // measures against §86's payload budget.
  //
  // The reason is §84. `Application.stats` is gated on `@fourjs/core`'s `DEV`:
  // `this.stats = DEV && options.stats === true ? createFrameStats() : null`.
  // In a production build `app.stats` is `null` — by design, since §85 permits a
  // production build to drop expensive diagnostics — so a page whose subject is
  // *instrumentation* cannot be built that way and still have anything to show.
  // A digital twin is an instrumented build; that is what a twin is for. The
  // price is recorded rather than hidden: the guarded paths (§84's statistics
  // wiring, §6a's duplicate-component warning, §83's leak audit, `devAssert`)
  // survive tree-shaking here, and `bun run size` measures the result against
  // this example's own budget in `.size-limit.json`.
  //
  // See docs/guides/performance-optimization.md for the production form, and
  // the module header of `main.ts` for the §84 half of this decision.
  build: {
    outDir: "dist",
  },
});
