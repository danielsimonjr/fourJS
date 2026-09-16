/**
 * This package's §81 capability tokens (RFC 0002; declared here since
 * 2026-08-29).
 *
 * RFC 0002 §2 spells it this way: *each token is exported from the package
 * that owns its registry*. The tokens first shipped together in
 * `@fourjs/four`'s `plugins.ts` — a recorded, reversible spelling difference —
 * and moved home once the owning packages were free; the umbrella still
 * re-exports the very same objects, so every existing import keeps working
 * and a token's identity (its `name` string) never changed.
 *
 * **The type imports are type-only, and that is load-bearing.** A token is
 * `{ name, revocable }` — a string and a boolean. Declaring
 * `RENDERER_REGISTRY: PluginCapability<RendererRegistry>` costs the emitted
 * JavaScript nothing but that object, so a bundle can carry the token an
 * application passes around without carrying `RendererRegistry`, the §62
 * preference walk, or any backend. Each definition is `@__PURE__`-annotated so
 * a token nothing references leaves the bundle entirely.
 */

import { defineCapability } from "@fourjs/core";

import type { ComputeWorkloadRegistry } from "./compute-workloads.js";
import type { RenderGraph } from "./render-graph.js";
import type { RendererRegistry } from "./renderer-registry.js";

/**
 * §81's *"renderer backends"*: the §62 registry a backend package registers
 * into (`registerWebglRenderer`, `registerWebgpuRenderer`).
 *
 * Not revocable — `RendererRegistry.register` returns the registry and the §62
 * front door offers no unregister on the shared instance, so a plugin that
 * registered a backend has no way to take it back.
 *
 * `Application` provides this **only when the application passed
 * `rendererRegistry`** (§45's scoped-registry option). With no registry to
 * scope, there is no `RendererRegistry` value the application holds — reaching
 * for the process-wide one would make `four` name the class in every bundle,
 * which is precisely the cost `resolveRenderer` exists to avoid. Applications
 * whose plugins register backends pass their own registry, or install through
 * a standalone `@fourjs/core` plugin host (its name is left unwritten here —
 * the §96 boundary test's textual ban is blunt on purpose).
 */
export const RENDERER_REGISTRY =
  /* @__PURE__ */ defineCapability<RendererRegistry>(
    "fourJS:renderer-registry",
  );

/**
 * §81's *"render passes"* — **differently shaped from the other five §81
 * tokens, and the shape is the point** (RFC 0002 Q4; owner decision, register
 * row 6: *"include `RENDER_GRAPH` as a differently-shaped capability with
 * that stated"*).
 *
 * There is no registry of pass *kinds*. §63's `RenderGraph` is an object the
 * application builds per frame-configuration, so what this token hands over is
 * **the application's own graph**, not a place to register a new kind of pass.
 * A post-processing plugin can append its passes to it, which is the useful
 * thing available today; a plugin that wants to teach the engine a new pass
 * kind cannot, and that is RFC 0001's closed-union position rather than an
 * oversight here.
 *
 * Not revocable. `RenderGraph.removePass` refuses while a later pass names the
 * removed one's output, so removal is conditional on the state of a graph the
 * host does not control — which is not a promise a lifecycle can keep.
 *
 * Provided only by a standalone `@fourjs/core` plugin host: §45 has no
 * render-graph option, and inventing one would be the API invention RFC 0002
 * Q1 was careful to avoid.
 */
export const RENDER_GRAPH = /* @__PURE__ */ defineCapability<RenderGraph>(
  "fourJS:render-graph",
);

/**
 * §81's *"compute workloads"*: a named {@link ComputeWorkloadRegistry} of
 * `ComputePassDescriptor` factories.
 *
 * Lives on this package, not a GPU backend, because the descriptor is
 * already backend-independent (`compute.ts`). Not revocable — the registry
 * has no removal. A plugin that registered a workload has no way to take
 * it back; re-registering the identical factory is a no-op.
 */
export const COMPUTE_WORKLOADS =
  /* @__PURE__ */ defineCapability<ComputeWorkloadRegistry>(
    "fourJS:compute-workloads",
  );
