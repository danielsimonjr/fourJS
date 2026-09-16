/**
 * A-8 / R-2 / PH-19 — `renderer: "auto"` and `solver: "auto"`, end to end
 * (2026-08-07).
 *
 * The three gaps were filed separately and designed as one thing, because they
 * are one claim about how packages depend on each other, and that claim cannot
 * be checked inside any single package:
 *
 * 1. **A name resolves to a real backend.** `@fourjs/render` holds a registry and
 *    imports no backend; `@fourjs/render-webgl` and `@fourjs/render-webgpu` register
 *    real renderers into it; `Application`, given the §45 string, ends up driving
 *    that renderer against a real GL or WebGPU sequence. Each package's own
 *    tests prove its half against a double — only this file puts the real ones
 *    together.
 * 2. **The same shape works for solvers.** `@fourjs/physics` holds a registry and
 *    imports no solver; `@fourjs/physics-rapier` registers the real adapters;
 *    `PhysicsWorld`, given `solver: "auto"`, simulates — under real wasm, with
 *    the dimension driving which adapter was built (§37's capability-driven
 *    selection).
 * 3. **Neither registry is consulted when nothing selects by name.** An
 *    application that hands over a constructed instance must resolve nothing,
 *    which is the property the whole design exists to preserve (§91) and the
 *    one a bundle-size gate can only measure after the fact.
 *
 * The GL context is a double, for the reason `packages/render-webgl/tests`
 * gives at length; WebGPU uses the recording device from
 * `helpers/recording-gpu.ts` for the same reason. Rapier is not — these worlds
 * run the real wasm.
 *
 * Every test uses its **own** registry rather than the shared one. That is not
 * only hygiene: it is the seam that makes two independent engines in one
 * process possible, and a suite that leaned on process-wide state would pass or
 * fail depending on file order.
 */

import { isFourError } from "@fourjs/core";
import { PhysicsWorld, SolverRegistry } from "@fourjs/physics";
import {
  Rapier2dAdapter,
  Rapier3dAdapter,
  registerRapierSolver,
} from "@fourjs/physics-rapier";
import { RendererRegistry, resolveRenderer } from "@fourjs/render";
import { WebglRenderer, registerWebglRenderer } from "@fourjs/render-webgl";
import { WebgpuRenderer, registerWebgpuRenderer } from "@fourjs/render-webgpu";
import {
  Group,
  PerspectiveCamera,
  Scene,
  createFullscreenViewport,
} from "@fourjs/scene";
import { Collider, RigidBody } from "@fourjs/physics";
import { Application } from "fourJS/application";
import { afterEach, describe, expect, it } from "vitest";

import { createRecordingGpu, withHostGpu } from "./helpers/recording-gpu.js";
import { RecordingCanvas, createRecordingGl } from "./helpers/recording-gl.js";

/** A canvas backed by a fresh recording GL context, plus its tape. */
function recordingSurface(): {
  canvas: RecordingCanvas;
  gl: ReturnType<typeof createRecordingGl>;
} {
  const gl = createRecordingGl();
  return { canvas: new RecordingCanvas(gl.gl), gl };
}

const GLOBAL = globalThis as Record<string, unknown>;
const WEBGL2_KEY = "WebGL2RenderingContext";

/**
 * Installs the `WebGL2RenderingContext` global the §62 probe reads.
 *
 * `isWebgl2Supported` deliberately answers a question about the *environment*
 * and never touches the canvas (a canvas hands out one context per type), so
 * the environment is what a test has to arrange. The canvas double below is
 * what actually serves the context.
 */
function withWebgl2(): void {
  GLOBAL[WEBGL2_KEY] = function WebGL2RenderingContext(): void {};
}

afterEach(() => {
  delete GLOBAL[WEBGL2_KEY];
});

describe('renderer: "auto" resolves to the real WebGL 2 backend', () => {
  it("builds, initializes, and draws through a registered backend", async () => {
    withWebgl2();
    const registry = new RendererRegistry();
    registerWebglRenderer(registry);

    const { canvas, gl } = recordingSurface();
    const camera = new PerspectiveCamera({ aspect: 1 });
    const app = new Application({
      renderer: "auto",
      canvas,
      rendererRegistry: registry,
      views: [createFullscreenViewport(camera)],
      width: 320,
      height: 240,
    });
    expect(app.renderer).toBeNull();

    await app.initialize();

    const renderer = app.renderer;
    expect(renderer).toBeInstanceOf(WebglRenderer);
    expect(renderer?.capabilities.backend).toBe("webgl2");
    // Initialized exactly once — by the registry, not again by the application.
    expect((renderer as WebglRenderer).initialized).toBe(true);
    // The size declared in the options reached the real backend.
    expect(gl.countOf("clear")).toBe(0);

    app.start();
    app.step(1 / 60);
    expect(gl.countOf("viewport")).toBeGreaterThan(0);
    expect(gl.countOf("clear")).toBeGreaterThan(0);

    app.dispose();
    renderer?.dispose();
  });

  it("falls back to WebGL 2 when the preferred backend fails to initialize (§62)", async () => {
    withWebgl2();
    const gpu = createRecordingGpu({ noAdapter: true });
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);
    registerWebglRenderer(registry);

    const { canvas } = recordingSurface();
    const reports: string[] = [];
    const renderer = await withHostGpu(gpu.gpu, () =>
      resolveRenderer(
        "auto",
        {
          canvas,
          onFallback: (report) =>
            reports.push(`${report.backend}:${report.reason}`),
        },
        registry,
      ),
    );
    expect(renderer).toBeInstanceOf(WebglRenderer);
    expect(reports).toEqual(["webgpu:initialization-failed"]);
    renderer.dispose();
  });

  it('"auto" selects WebGPU ahead of a registered WebGL 2 backend (§62)', async () => {
    withWebgl2();
    const gpu = createRecordingGpu();
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);
    registerWebglRenderer(registry);

    const app = await withHostGpu(gpu.gpu, async () => {
      const camera = new PerspectiveCamera({ aspect: 1 });
      const application = new Application({
        renderer: "auto",
        canvas: gpu.canvas,
        rendererRegistry: registry,
        views: [createFullscreenViewport(camera)],
        width: 320,
        height: 240,
      });
      await application.initialize();
      return application;
    });

    const renderer = app.renderer;
    expect(renderer).toBeInstanceOf(WebgpuRenderer);
    expect(renderer?.capabilities.backend).toBe("webgpu");

    app.start();
    app.step(1 / 60);
    expect(gpu.countOf("queue.submit")).toBeGreaterThan(0);

    app.dispose();
    renderer?.dispose();
  });

  it("names what is registered when nothing can be selected (§85)", async () => {
    const registry = new RendererRegistry();
    registerWebglRenderer(registry);
    // No `WebGL2RenderingContext` in this runtime, so the probe refuses and
    // §62's ladder runs out.
    let thrown: unknown;
    try {
      await resolveRenderer("auto", undefined, registry);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
      expect(thrown.message).toContain('Registered: "webgl2"');
      expect(thrown.message).toContain('"webgl2" (unsupported)');
    }
  });

  it("consults no registry at all when the application hands over an instance", async () => {
    withWebgl2();
    const registry = new RendererRegistry();
    // A registry whose every entry throws if built: reaching it is the failure.
    registry.register({
      backend: "webgl2",
      isSupported: () => {
        throw new Error("the registry must not be consulted");
      },
      create: () => {
        throw new Error("the registry must not be consulted");
      },
    });

    const { canvas } = recordingSurface();
    const renderer = new WebglRenderer();
    const app = new Application({
      renderer,
      canvas,
      rendererRegistry: registry,
    });
    expect(app.renderer).toBe(renderer);
    await app.initialize();
    expect(renderer.initialized).toBe(true);
    app.dispose();
    renderer.dispose();
  });
});

describe('solver: "auto" resolves to the real Rapier adapters (§37)', () => {
  it("builds the 2D adapter for a 2D world and simulates", async () => {
    const registry = new SolverRegistry();
    registerRapierSolver(registry);

    const world = new PhysicsWorld({
      dimension: "2d",
      solver: "auto",
      solverRegistry: registry,
    });
    expect(world.adapter).toBeInstanceOf(Rapier2dAdapter);
    await world.initialize();

    const scene = new Scene();
    const node = new Group();
    node.transform.position.set(0, 5, 0);
    node.transformAuthority = "physics";
    node.addComponent(new RigidBody({ type: "dynamic" }));
    // A body with no collider has zero mass and Rapier leaves it where it is;
    // gravity needs something to act on (§23).
    node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
    scene.add(node);
    world.addBody(node);
    for (let step = 0; step < 30; step += 1) {
      world.step(1 / 60);
    }
    // Gravity is negative Y in 2D as in 3D (§7a).
    expect(node.transform.position.y).toBeLessThan(5);
    world.dispose();
  });

  it("builds the 3D adapter for a 3D world, from the same registration", async () => {
    const registry = new SolverRegistry();
    registerRapierSolver(registry);
    const world = new PhysicsWorld({
      dimension: "3d",
      solver: "auto",
      solverRegistry: registry,
    });
    expect(world.adapter).toBeInstanceOf(Rapier3dAdapter);
    await world.initialize();
    world.dispose();
  });

  it("refuses a §33 tier Rapier does not declare, rather than downgrading", () => {
    const registry = new SolverRegistry();
    registerRapierSolver(registry);
    expect(
      () =>
        new PhysicsWorld({
          dimension: "3d",
          determinism: "cross-platform",
          solver: "auto",
          solverRegistry: registry,
        }),
    ).toThrow(/"rapier" \(determinism\)/);
  });

  it("consults no registry at all when the application hands over an adapter", async () => {
    const registry = new SolverRegistry();
    registry.register({
      name: "rapier",
      isSupported: () => {
        throw new Error("the registry must not be consulted");
      },
      create: () => {
        throw new Error("the registry must not be consulted");
      },
    });
    const world = new PhysicsWorld({
      dimension: "3d",
      adapter: new Rapier3dAdapter(),
      solverRegistry: registry,
    });
    await world.initialize();
    world.dispose();
  });
});
