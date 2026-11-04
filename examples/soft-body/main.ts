/**
 * fourJS — soft bodies (RFC 0011, §35a): a cloth and a rope driven by
 * `SoftBodySystem`, drawn through the ordinary WebGL path.
 *
 * Both bodies start horizontal and are released under gravity. The cloth is
 * pinned at two corners of its back edge, the rope at one end; pinned particles
 * follow the node transform, every other vertex is owned by the `"physics"`
 * authority (§42) and written into the body's dynamic geometry once per fixed
 * step. The page publishes the lowest particle of each body on `#status` so a
 * browser gate can watch the cloth descend and settle, and exposes
 * `window.fourSoftDigest(steps)`, a self-contained headless run whose geometry
 * digest must be identical every time (§33 same-runtime determinism).
 */

import { Application } from "fourJS/application";
import { LitMaterial, UnlitMaterial } from "fourJS/materials";
import { Vector3 } from "fourJS/math";
import { SoftBody, SoftBodySystem } from "fourJS/physics-soft";
import { Renderable } from "fourJS/render";
import { WebglRenderer } from "fourJS/render-webgl";
import {
  DirectionalLight,
  Group,
  PerspectiveCamera,
  createFullscreenViewport,
} from "fourJS/scene";

declare global {
  interface Window {
    /** Headless run of the cloth for `steps` fixed steps; returns a geometry digest. */
    fourSoftDigest?: (steps: number) => string;
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`fourJS example: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const status = requireElement<HTMLParagraphElement>("#status");

const WIDTH = 800;
const HEIGHT = 600;
const FIXED_DELTA = 1 / 60;

/** Where the cloth's pin line hangs, world units. */
const CLOTH_ORIGIN = new Vector3(-0.4, 1.6, 0);
/** Where the rope is pinned. */
const ROPE_ORIGIN = new Vector3(3.2, 1.6, 0);

/** The cloth: 16 x 16 particles, 2 x 2 m, pinned at both ends of its back row. */
function createCloth(): SoftBody {
  return new SoftBody({
    kind: "cloth",
    columns: 16,
    rows: 16,
    width: 2,
    height: 2,
    pinned: [0, 15],
    damping: 1.5,
  });
}

/** The rope: 24 particles, 2 m, pinned at the first. */
function createRope(): SoftBody {
  return new SoftBody({
    kind: "rope",
    segments: 24,
    length: 2,
    damping: 1,
  });
}

/** Lowest world-space y over every particle. */
function lowestY(body: SoftBody): number {
  const p = body.solver?.positions;
  if (p === undefined) return 0;
  let low = Infinity;
  for (let i = 1; i < p.length; i += 3) low = Math.min(low, p[i] ?? 0);
  return low;
}

/** FNV-1a over the float32 bit patterns of the geometry positions. */
function digest(positions: Float32Array): string {
  const bits = new Uint32Array(
    positions.buffer,
    positions.byteOffset,
    positions.length,
  );
  let h = 0x811c9dc5;
  for (const word of bits) {
    h = Math.imul(h ^ word, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// A headless, app-independent run: the same cloth, stepped by hand.
window.fourSoftDigest = (steps: number): string => {
  const node = new Group();
  node.transform.position.copy(CLOTH_ORIGIN);
  const body = node.addComponent(createCloth());
  const system = new SoftBodySystem();
  system.track(body);
  const context = { time: { fixedDeltaTime: FIXED_DELTA } } as never;
  for (let i = 0; i < steps; i++) system.fixedUpdate(context);
  return digest(body.geometry.positions);
};

// --- scene ------------------------------------------------------------------

const camera = new PerspectiveCamera({
  fieldOfView: Math.PI / 4,
  aspect: WIDTH / HEIGHT,
  near: 0.1,
  far: 100,
});
camera.transform.position.set(1.4, 1.2, 8);
camera.lookAt(new Vector3(1.4, 0.2, 0));
camera.updateProjectionMatrix();

const view = createFullscreenViewport(camera);
view.clearColor = [0.045, 0.05, 0.075, 1];

const renderer = new WebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);
app.scene.add(camera);
app.scene.ambientLight[0] = 0.3;
app.scene.ambientLight[1] = 0.32;
app.scene.ambientLight[2] = 0.38;

const sun = new DirectionalLight({ color: [1, 0.96, 0.9], intensity: 1.2 });
sun.transform.position.set(-3, 6, 6);
sun.lookAt(new Vector3(0, 0, 0));
app.scene.add(sun);

const clothBody = createCloth();
const cloth = new Renderable(
  clothBody.geometry,
  new LitMaterial({ color: [0.9, 0.35, 0.3, 1] }),
);
cloth.name = "cloth";
cloth.transform.position.copy(CLOTH_ORIGIN);
cloth.addComponent(clothBody);
app.scene.add(cloth);

const ropeBody = createRope();
const rope = new Renderable(
  ropeBody.geometry,
  new UnlitMaterial({ color: [0.45, 0.85, 0.5, 1] }),
);
rope.name = "rope";
rope.transform.position.copy(ROPE_ORIGIN);
// Rotate the rope so it starts horizontal, extending toward -X.
rope.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
rope.addComponent(ropeBody);
app.scene.add(rope);

const softSystem = new SoftBodySystem();
app.systems.register(softSystem);
softSystem.track(clothBody);
softSystem.track(ropeBody);

// --- status -----------------------------------------------------------------

let frameCount = 0;

app.on("update", (time) => {
  frameCount += 1;
  status.dataset["state"] = "running";
  status.dataset["frames"] = String(frameCount);
  status.dataset["steps"] = String(time.simulationStep);
  status.dataset["clothLowestY"] = lowestY(clothBody).toFixed(5);
  status.dataset["ropeLowestY"] = lowestY(ropeBody).toFixed(5);
  status.dataset["clothDigest"] = digest(clothBody.geometry.positions);
  status.textContent = `cloth lowest y ${lowestY(clothBody).toFixed(3)} m, rope lowest y ${lowestY(ropeBody).toFixed(3)} m — step ${String(time.simulationStep)}`;
});

let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
  }
  last = now;
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  await app.initialize();
  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.dataset["state"] = "error";
  status.textContent = "failed to start — see the console";
  console.error("fourJS example: failed to start.", error);
});
