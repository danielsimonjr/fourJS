/**
 * RFC 0005's owed §86 measurements — id-pass cost versus the flagship-order
 * (and R-8) render list, and fence-versus-stall pick latency (§71, §64, §86).
 *
 * ```sh
 * bun run build
 * node benchmarks/pick-latency.mjs
 * ```
 *
 * ## What is measured
 *
 * RFC 0005 §Prototype asked for two numbers this packet records:
 *
 * 1. **Pass cost.** `PickingService.update` is a second render pass
 *    proportional to the render list. One arm times that call; the other
 *    times the list the pass itself builds (`buildRenderList` +
 *    `buildViewRenderList`). The difference is the id draw on top of the
 *    list — the cheapest honest comparison the public APIs allow. Particle
 *    systems are not in these scenes: the harness times unlit rectangles
 *    so the id-pass vs list ratio is not mixed with `ParticleIdProgram`.
 * 2. **Read-back latency.** `PickingService.pick` chooses the fence path
 *    (`PIXEL_PACK_BUFFER` + `fenceSync`) when those entry points exist, and
 *    the stalling `readPixels` otherwise. Both arms are timed when the
 *    service can reach them.
 *
 * ## Host GPU, and why a second number may be absent
 *
 * A real WebGL 2 context is probed first. This container typically has none,
 * so the service is driven through the same structural `PickingRendererHost`
 * + counting GL seam `gl-picking.test.ts` uses — JavaScript plus that seam,
 * **not** driver time, GPU time, or a frame of display latency. WebGPU has
 * `mapAsync` for §61 `readPixels` but **no** `PickingService`, so there is
 * no mapAsync pick path to time; that number is not invented.
 *
 * When the counting seam exposes both read-back groups, both sequences are
 * timed and labelled as such. When a real context exists and only one group
 * is present, only that path is timed. `performance.now()` lives in
 * `harness.mjs`. Recorded, never gated.
 */

import { Frustum, Matrix4 } from "@fourjs/math";
import { UnlitMaterial } from "@fourjs/materials";
import {
  Rectangle,
  buildRenderList,
  buildViewRenderList,
} from "@fourjs/render";
import {
  GL,
  GeometryCache,
  PICKING_GL,
  RenderTargetCache,
  WebglPickingService,
} from "@fourjs/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";

import {
  MEASUREMENT_NOTE,
  hostLines,
  hostRecord,
  keepAlive,
  keepAliveTotal,
  measure,
  printReport,
  round,
  summarize,
  summaryFields,
  writeResult,
} from "./harness.mjs";

/**
 * §118 flagship order of magnitude. The shipped
 * `one-scene-everything-moves` demo is tens of id-pass candidates (named
 * meshes + 16 orbit dots + Text labels + UI skin quads; two particle
 * systems are skipped by the pass). 64 rectangles is that order, one
 * material, no particles.
 */
const FLAGSHIP_N = 64;

/** R-8's culling-suite list sizes, which RFC 0005 named beside the 1× row. */
const R8_LIST_COUNTS = [10000, 50000, 100000];

const NODE_COUNTS = [FLAGSHIP_N, ...R8_LIST_COUNTS];

/** §45 `fixedTimeStep`, in seconds — injected; never read from a clock. */
const FIXED_DELTA_TIME = 1 / 60;

const FIXED_STEP_BUDGET_MS = FIXED_DELTA_TIME * 1000;

const MEASURED_PASSES = 30;
const WARMUP_PASSES = 10;

const MEASURED_PICKS = 200;
const WARMUP_PICKS = 50;

const MS_DIGITS = 4;

const SEED = 0x1d3b7f05;

const VIEW_HALF_WIDTH = 16;
const VIEW_HALF_HEIGHT = 9;

const SURFACE_WIDTH = 64;
const SURFACE_HEIGHT = 64;

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Probes this process for a real WebGL 2 context and the two read-back
 * groups `pick` branches on. Presence is the capability; absence is not
 * invented into a number.
 */
function probeHostGpu() {
  const empty = {
    webgl2: false,
    stallReadPixels: false,
    fenceEntryPoints: false,
    webgpuPickingService: false,
    source: "none",
  };
  const candidates = [];
  try {
    if (typeof OffscreenCanvas === "function") {
      candidates.push(() => new OffscreenCanvas(SURFACE_WIDTH, SURFACE_HEIGHT));
    }
  } catch {
    // OffscreenCanvas may exist as a name and still throw on construct.
  }
  try {
    if (typeof document === "object" && document !== null) {
      const doc = document;
      if (typeof doc.createElement === "function") {
        candidates.push(() => doc.createElement("canvas"));
      }
    }
  } catch {
    // No document, or createElement refused.
  }

  for (const makeCanvas of candidates) {
    try {
      const canvas = makeCanvas();
      const getContext = canvas?.getContext;
      if (typeof getContext !== "function") {
        continue;
      }
      const gl = getContext.call(canvas, "webgl2");
      if (gl === null || gl === undefined) {
        continue;
      }
      return {
        webgl2: true,
        stallReadPixels: typeof gl.readPixels === "function",
        fenceEntryPoints:
          typeof gl.fenceSync === "function" &&
          typeof gl.clientWaitSync === "function" &&
          typeof gl.deleteSync === "function" &&
          typeof gl.getBufferSubData === "function",
        webgpuPickingService: false,
        source: canvas.constructor?.name ?? "canvas",
      };
    } catch {
      // This candidate is not a usable drawing surface.
    }
  }
  return empty;
}

/**
 * Counting WebGL 2 double — the geometry-updates seam applied to the
 * members `WebglPickingService`, `GeometryCache`, and `RenderTargetCache`
 * touch. No call log: a 100 000-item pass would otherwise allocate one
 * record per GL call.
 *
 * @param {{ fence?: boolean }} [options]
 */
function countingGl(options = {}) {
  const fence = options.fence === true;
  const counts = {
    drawElements: 0,
    drawArrays: 0,
    readPixels: 0,
    fenceSync: 0,
    clientWaitSync: 0,
    getBufferSubData: 0,
  };
  let serial = 0;
  const handle = () => {
    serial += 1;
    return { serial };
  };
  /** RGBA8 the next `readPixels` / pack-buffer copy answers with. */
  let nextTexel = [1, 0, 0, 0];
  let packPending = null;

  const gl = {
    createShader: () => handle(),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader() {},
    createProgram: () => handle(),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram() {},
    getUniformLocation: (_program, name) => ({ name }),
    useProgram() {},
    uniformMatrix4fv() {},
    uniform4fv() {},
    uniform3fv() {},
    uniform1f() {},
    uniform1i() {},
    createTexture: () => handle(),
    bindTexture() {},
    texImage2D() {},
    texParameteri() {},
    deleteTexture() {},
    activeTexture() {},
    createFramebuffer: () => handle(),
    bindFramebuffer() {},
    framebufferTexture2D() {},
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    deleteFramebuffer() {},
    createRenderbuffer: () => handle(),
    bindRenderbuffer() {},
    renderbufferStorage() {},
    framebufferRenderbuffer() {},
    deleteRenderbuffer() {},
    createBuffer: () => handle(),
    bindBuffer() {},
    bufferData() {},
    deleteBuffer() {},
    createVertexArray: () => handle(),
    bindVertexArray() {},
    deleteVertexArray() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getParameter: () => 4096,
    enable() {},
    disable() {},
    depthFunc() {},
    frontFace() {},
    viewport() {},
    scissor() {},
    clearColor() {},
    clearDepth() {},
    clear() {},
    blendFunc() {},
    depthMask() {},
    colorMask() {},
    stencilFunc() {},
    stencilOp() {},
    stencilMask() {},
    drawArrays() {
      counts.drawArrays += 1;
    },
    drawElements() {
      counts.drawElements += 1;
    },
    isContextLost: () => false,
    readPixels(_x, _y, _w, _h, _format, _type, into) {
      counts.readPixels += 1;
      if (typeof into === "number") {
        packPending = nextTexel;
        return;
      }
      into.set(nextTexel);
    },
  };

  if (fence) {
    gl.fenceSync = () => {
      counts.fenceSync += 1;
      return handle();
    };
    gl.clientWaitSync = () => {
      counts.clientWaitSync += 1;
      return PICKING_GL.ALREADY_SIGNALED;
    };
    gl.deleteSync = () => {};
    gl.getBufferSubData = (_target, _offset, into) => {
      counts.getBufferSubData += 1;
      if (packPending !== null) {
        into.set(packPending);
      }
    };
  }

  return {
    gl,
    counts,
    setNextTexel(bytes) {
      nextTexel = bytes;
    },
    resetCounts() {
      counts.drawElements = 0;
      counts.drawArrays = 0;
      counts.readPixels = 0;
      counts.fenceSync = 0;
      counts.clientWaitSync = 0;
      counts.getBufferSubData = 0;
    },
  };
}

/**
 * The host double the service reads. Typed against the renderer's own host
 * contract so a member the service starts asking for (as `particleBatches()`
 * did in #86) fails `bun run typecheck:benchmarks` instead of the run.
 *
 * @returns {import("@fourjs/render-webgl").PickingRendererHost}
 */
function createHost(counter) {
  const geometries = new GeometryCache(counter.gl);
  const renderTargets = new RenderTargetCache(counter.gl);
  return {
    context: () => counter.gl,
    geometries: () => geometries,
    renderTargets: () => renderTargets,
    // No particle systems in these scenes (the header says so); the service
    // still asks the host for the batch cache before the id pass (#86).
    particleBatches: () => null,
    surfaceWidth: () => SURFACE_WIDTH,
    surfaceHeight: () => SURFACE_HEIGHT,
    contextLost: () => false,
    disposed: () => false,
  };
}

/**
 * `count` §50 rectangles over one `UnlitMaterial`, placed inside the
 * camera box so the frustum keeps every item — the id pass then draws the
 * same list the list arm built.
 */
function pickScene(count) {
  const random = createRandom(SEED);
  const scene = new Scene();
  const material = new UnlitMaterial({ color: [0.2, 0.6, 1, 1] });
  for (let i = 0; i < count; i += 1) {
    const node = new Rectangle({ material, width: 0.3, height: 0.2 });
    node.transform.position.set(
      random() * VIEW_HALF_WIDTH * 1.6 - VIEW_HALF_WIDTH * 0.8,
      random() * VIEW_HALF_HEIGHT * 1.6 - VIEW_HALF_HEIGHT * 0.8,
      0,
    );
    scene.add(node);
  }
  return scene;
}

function createView() {
  const camera = new OrthographicCamera({
    left: -VIEW_HALF_WIDTH,
    right: VIEW_HALF_WIDTH,
    bottom: -VIEW_HALF_HEIGHT,
    top: VIEW_HALF_HEIGHT,
  });
  camera.transform.position.set(0, 0, 5);
  camera.updateProjectionMatrix();
  camera.updateViewMatrix();
  return createFullscreenViewport(camera);
}

function listWork(scene, view, items, viewItems, frustum, viewProjection) {
  const camera = view.camera;
  camera.updateViewMatrix();
  viewProjection.copy(camera.projectionMatrix).multiply(camera.viewMatrix);
  frustum.setFromViewProjection(viewProjection);
  const listed = buildRenderList(scene, items);
  const visible = buildViewRenderList(listed, view, viewItems, { frustum });
  return visible.length;
}

/** @returns {Record<string, any>} the summary keys are built by `summaryFields` */
function runTimed(iteration, warmupIterations, measuredIterations) {
  const { warmup, measured } = measure(iteration, {
    warmupIterations,
    measuredIterations,
  });
  return {
    warmupMeanMsPerPass: round(summarize(warmup).meanMs, MS_DIGITS),
    ...summaryFields(summarize(measured), "Pass", MS_DIGITS),
    measuredSummary: summarize(measured),
  };
}

const hostGpu = probeHostGpu();

const items = [];
const viewItems = [];
const viewProjection = new Matrix4();
const frustum = new Frustum();

const passRows = [];
let pickFence = null;
let pickStall = null;
let pickPathNote = "";

for (const nodeCount of NODE_COUNTS) {
  const scene = pickScene(nodeCount);
  const view = createView();
  resolveWorldTransforms(scene);

  const listRow = runTimed(
    () => {
      keepAlive(
        listWork(scene, view, items, viewItems, frustum, viewProjection),
      );
    },
    WARMUP_PASSES,
    MEASURED_PASSES,
  );

  const fenceCounter = countingGl({ fence: true });
  const fenceService = new WebglPickingService(createHost(fenceCounter));
  fenceCounter.setNextTexel([1, 0, 0, 0]);
  fenceService.update(scene, view);
  if (
    fenceCounter.counts.drawElements + fenceCounter.counts.drawArrays !==
    nodeCount
  ) {
    throw new Error(
      `pick-latency: id pass drew ${String(
        fenceCounter.counts.drawElements + fenceCounter.counts.drawArrays,
      )} items, expected ${String(nodeCount)}`,
    );
  }
  fenceCounter.resetCounts();

  const idPassRow = runTimed(
    () => {
      fenceService.update(scene, view);
    },
    WARMUP_PASSES,
    MEASURED_PASSES,
  );
  keepAlive(fenceCounter.counts.drawElements + fenceCounter.counts.drawArrays);

  const listed = listWork(
    scene,
    view,
    items,
    viewItems,
    frustum,
    viewProjection,
  );
  if (listed !== nodeCount) {
    throw new Error(
      `pick-latency: view list kept ${String(listed)} of ${String(nodeCount)}`,
    );
  }

  const idOverListMs = round(
    idPassRow.meanMsPerPass - listRow.meanMsPerPass,
    MS_DIGITS,
  );

  passRows.push({
    nodes: nodeCount,
    role: nodeCount === FLAGSHIP_N ? "flagship-order" : "r8-list",
    listItems: listed,
    list: {
      warmupMeanMsPerPass: listRow.warmupMeanMsPerPass,
      ...summaryFields(listRow.measuredSummary, "Pass", MS_DIGITS),
    },
    idPass: {
      warmupMeanMsPerPass: idPassRow.warmupMeanMsPerPass,
      ...summaryFields(idPassRow.measuredSummary, "Pass", MS_DIGITS),
    },
    idPassOverListMs: idOverListMs,
    idPassOverListRatio: round(
      idPassRow.meanMsPerPass / Math.max(listRow.meanMsPerPass, 1e-9),
      4,
    ),
    meanFractionOfFixedStepBudget: round(
      idPassRow.meanMsPerPass / FIXED_STEP_BUDGET_MS,
      4,
    ),
  });

  if (nodeCount === FLAGSHIP_N) {
    const stallCounter = countingGl({ fence: false });
    const stallService = new WebglPickingService(createHost(stallCounter));
    stallCounter.setNextTexel([1, 0, 0, 0]);
    stallService.update(scene, view);

    const request = { viewport: view, ndcX: 0, ndcY: 0 };

    fenceCounter.resetCounts();
    const fenceProbe = await fenceService.pick(request);
    if (fenceProbe.nodeId === undefined) {
      throw new Error("pick-latency: fence pick resolved nothing");
    }
    if (fenceCounter.counts.fenceSync < 1) {
      throw new Error("pick-latency: fence arm did not call fenceSync");
    }
    keepAlive(fenceProbe.nodeId.length);

    stallCounter.resetCounts();
    const stallProbe = await stallService.pick(request);
    if (stallProbe.nodeId === undefined) {
      throw new Error("pick-latency: stall pick resolved nothing");
    }
    if (stallCounter.counts.fenceSync !== 0) {
      throw new Error("pick-latency: stall arm called fenceSync");
    }
    if (stallCounter.counts.readPixels < 1) {
      throw new Error("pick-latency: stall arm did not call readPixels");
    }
    keepAlive(stallProbe.nodeId.length);

    const fenceTimed = runTimed(
      () => {
        const pending = fenceService.pick(request);
        keepAlive(typeof pending.then === "function" ? 1 : 0);
      },
      WARMUP_PICKS,
      MEASURED_PICKS,
    );

    const stallTimed = runTimed(
      () => {
        const pending = stallService.pick(request);
        keepAlive(typeof pending.then === "function" ? 1 : 0);
      },
      WARMUP_PICKS,
      MEASURED_PICKS,
    );

    const pickFields = (timed) => ({
      warmupMeanMsPerPick: timed.warmupMeanMsPerPass,
      ...summaryFields(timed.measuredSummary, "Pick", MS_DIGITS),
      extraFrames: 0,
    });

    pickFence = {
      path: "fence",
      entryPoints:
        "PIXEL_PACK_BUFFER + fenceSync + clientWaitSync + getBufferSubData",
      ...pickFields(fenceTimed),
    };
    pickStall = {
      path: "stall",
      entryPoints: "readPixels into a Uint8Array",
      ...pickFields(stallTimed),
    };
    pickPathNote =
      "Both read-back sequences were reachable on the counting GL seam " +
      "(fence group present vs omitted). clientWaitSync answered " +
      "ALREADY_SIGNALED, so neither path waited a macrotask — extraFrames " +
      "is 0 for both. These are JS + seam costs, not GPU/driver latency.";
  }
}

if (pickFence === null || pickStall === null) {
  throw new Error("pick-latency: flagship-order pick arms did not run");
}

const flagship = passRows.find((row) => row.role === "flagship-order");
const r8Largest = passRows.find((row) => row.nodes === 100000);

const host = hostRecord();
const hostCaveat =
  hostGpu.webgl2 === false
    ? "CI container, no WebGL 2, no GPU. Id-pass and pick numbers are the service plus a counting GL seam, not driver or GPU time. WebGPU's PickingService (mapAsync, 2026-09-09) is not exercised here: no WebGPU device in this container."
    : hostGpu.fenceEntryPoints
      ? "WebGL 2 is present; fence entry points are present. Numbers still include this process's wall clock around the public API, not a GPU timer query."
      : "WebGL 2 is present without the fence group; only the stalling readPixels path exists on this host.";

const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "pick-latency",
  specification:
    "RFC 0005 prototype: id-pass cost vs the flagship / R-8 render list, and fence-vs-stall pick latency; §71, §64, §86",
  recordedAt: new Date().toISOString(),
  flagshipOrderNodes: FLAGSHIP_N,
  flagshipOrderNote:
    "The §118 flagship is O(10²) id-pass candidates (named meshes, 16 orbit dots, Text, UI skin quads; particle systems skipped). 64 is that order of magnitude. R-8 sizes are 10 000 / 50 000 / 100 000.",
  particleIdProgram: false,
  particleIdProgramNote:
    "This harness times unlit rectangles. ParticleIdProgram exists (2026-09-09) but is not in these scenes.",
  fixedDeltaTimeSeconds: round(FIXED_DELTA_TIME, 9),
  fixedStepBudgetMs: round(FIXED_STEP_BUDGET_MS, 4),
  measuredPasses: MEASURED_PASSES,
  warmupPasses: WARMUP_PASSES,
  measuredPicks: MEASURED_PICKS,
  warmupPicks: WARMUP_PICKS,
  hostGpu,
  secondHostPickPathAvailable:
    hostGpu.webgl2 && hostGpu.fenceEntryPoints && hostGpu.stallReadPixels,
  webgpuMapAsyncPickPath: false,
  pass: passRows,
  pick: {
    measuredOn:
      hostGpu.webgl2 === true ? "host-webgl2" : "structural-gl-double",
    note: pickPathNote,
    fence: pickFence,
    stall: pickStall,
    fenceMinusStallMs: round(
      pickFence.meanMsPerPick - pickStall.meanMsPerPick,
      MS_DIGITS,
    ),
  },
  proposedSection86:
    `Id pass over ${String(FLAGSHIP_N)} rectangles: ${String(
      flagship.idPass.meanMsPerPass,
    )} ms/pass (${String(flagship.idPassOverListRatio)}× the ` +
    `${String(flagship.list.meanMsPerPass)} ms list). At R-8's 100 000: ` +
    `${String(r8Largest.idPass.meanMsPerPass)} ms/pass vs ` +
    `${String(r8Largest.list.meanMsPerPass)} ms list. Fence pick ` +
    `${String(pickFence.meanMsPerPick)} ms, stall pick ` +
    `${String(pickStall.meanMsPerPick)} ms, both extraFrames=0 on the ` +
    `counting seam. Not a gate — this host is not §86's "suitable hardware".`,
  keepAliveTotal: keepAliveTotal(),
  ...host,
  hostCaveat,
};

const path = writeResult("pick-latency", record);

printReport([
  "fourJS — RFC 0005 id-pass cost and fence-vs-stall pick latency (§71, §64, §86)",
  `  scenes                  ${NODE_COUNTS.join(" / ")} rectangles (64 = flagship-order; rest = R-8)`,
  `  60 Hz budget            ${round(FIXED_STEP_BUDGET_MS, 3)} ms/step`,
  `  host WebGL 2            ${hostGpu.webgl2 ? `yes (${hostGpu.source})` : "no"}`,
  `  host fence group        ${hostGpu.fenceEntryPoints ? "yes" : "no"}`,
  `  host stall readPixels   ${hostGpu.stallReadPixels ? "yes" : "no"}`,
  `  WebGPU pick path        no (PickingService is not on the WebGPU backend)`,
  `  measured pick on        ${record.pick.measuredOn}`,
  "",
  " nodes   list ms/pass   id-pass ms/pass   id−list   ratio   % of 16.7 ms",
  ...passRows.map((row) =>
    [
      String(row.nodes).padStart(6),
      String(row.list.meanMsPerPass).padStart(14),
      String(row.idPass.meanMsPerPass).padStart(18),
      String(row.idPassOverListMs).padStart(10),
      String(row.idPassOverListRatio).padStart(8),
      String(round(row.meanFractionOfFixedStepBudget * 100, 1)).padStart(14),
    ].join(""),
  ),
  "",
  `  fence pick              ${pickFence.meanMsPerPick} ms/pick  (extraFrames ${String(pickFence.extraFrames)})`,
  `  stall pick              ${pickStall.meanMsPerPick} ms/pick  (extraFrames ${String(pickStall.extraFrames)})`,
  `  fence − stall           ${record.pick.fenceMinusStallMs} ms`,
  `  pick note               ${pickPathNote}`,
  `  proposed §86            ${record.proposedSection86}`,
  "",
  ...hostLines(host, hostCaveat),
  "",
  `  written                 ${path}`,
]);
