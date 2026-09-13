/**
 * Browser gate for `examples/character-controller` — the §12 controller
 * family, measured from outside the page (the PH-11/PH-11b examples
 * follow-up, 2026-08-29).
 *
 * `tests/integration/swept-character.test.ts` proves the sweeps against real
 * Rapier; `tests/integration/first-person-camera.test.ts` proves the
 * yaw ∘ pitch composition; `tests/determinism/swept-character.test.ts` pins
 * the arithmetic. None of them answers whether the composed thing *works in a
 * browser*: whether the wasm loads, whether real keyboard input reaches the
 * §39 pipeline, whether the step-up climbs real stairs, and whether the
 * first-person eye actually swings the rendered view. Those are what this file
 * measures, through Chromium's real keyboard and framebuffer.
 *
 * ```text
 * Chromium keyboard → held-key set → ControlSystem (100) → SweptCharacterSystem (400)
 *   → PhysicsWorld.shapeCast (§30) → node transform → kinematic RigidBody feed
 *   → PhysicsSystem (600) → §43 interpolation → WebglRenderer → pixels
 * ```
 *
 * ## The tenth site
 *
 * `playwright.config.ts` serves the built example on {@link CHARACTER_URL}'s
 * port; the port is restated here for the reason every sibling spec gives — a
 * browser gate checks the built page from the outside. Run
 * `bun run character:build` before `bun run test:browser`, or the preview server has
 * no `dist` to serve.
 *
 * ## What is measured, and against what
 *
 * | test | § | assertion |
 * | ---- | -- | --------- |
 * | loads | §12, §37 | `data-state="running"` (wasm decoded), the canvas draws a non-trivial frame |
 * | jump | §12 | Space lifts `data-py` well above the standing height and lands back grounded |
 * | walk | §12, §30, §39 | holding W climbs all three risers by step-up (`data-stepups ≥ 3`), reaches the platform height, and is *stopped* by the north wall rather than tunnelling |
 * | look | §44 | ←/→ writes yaw, ↑/↓ writes pitch, and the rendered view visibly swings |
 * | patrol | §12 | the plane-tier `CharacterController` walks its circle with no input at all, while the idle player writes nothing |
 *
 * Every threshold states what the reference run measured (2026-08-29, this
 * machine, SwiftShader, under CI-like CPU contention) and the margin left.
 * Nothing here is a golden image (§92).
 *
 * ## Method notes
 *
 * The scene's numbers are **restated** from the example rather than imported
 * (`playground.spec.ts`'s rule): a wrong scene must not be able to agree with
 * a wrong expectation. The PNG decoder is the sibling specs' copy, for the
 * reason they each state: Playwright returns an encoded screenshot, the
 * workspace pins no image library, and this packet's file scope forbids
 * editing a sibling spec to share one.
 *
 * The `data-*` attributes are the engine's own account of the character; every
 * behavioural assertion reads them **alongside** at least one pixel
 * measurement per session (non-blank at load, view swing on look), so a page
 * that simulated perfectly but drew nothing cannot pass.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { framesFor, waitForFrames } from "./helpers/wait.js";

/** A decoded, unfiltered 8-bit image: `pixels` is `width * height` samples. */
interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Bytes per pixel — 3 for RGB screenshots, 4 for RGBA. */
  readonly bytesPerPixel: number;
  readonly pixels: Buffer;
}

const PNG_SIGNATURE = 0x89504e47;

/** Samples per pixel for the PNG colour types Chromium emits. */
function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // truecolour
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // truecolour + alpha
    default:
      throw new Error(`Unsupported PNG colour type ${String(colorType)}.`);
  }
}

/** Undoes one PNG scanline filter byte (RFC 2083 §6). */
function unfilterByte(
  filter: number,
  raw: number,
  left: number,
  above: number,
  upperLeft: number,
): number {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return raw + left;
    case 2:
      return raw + above;
    case 3:
      return raw + ((left + above) >> 1);
    case 4: {
      const estimate = left + above - upperLeft;
      const dLeft = Math.abs(estimate - left);
      const dAbove = Math.abs(estimate - above);
      const dUpperLeft = Math.abs(estimate - upperLeft);
      if (dLeft <= dAbove && dLeft <= dUpperLeft) return raw + left;
      return dAbove <= dUpperLeft ? raw + above : raw + upperLeft;
    }
    default:
      throw new Error(`Unsupported PNG filter type ${String(filter)}.`);
  }
}

/**
 * Decodes a non-interlaced 8-bit PNG — the only kind Playwright produces —
 * into raw samples. Deliberately dependency-free (see "Method notes").
 */
function decodePng(png: Buffer): DecodedImage {
  if (png.length < 8 || png.readUInt32BE(0) !== PNG_SIGNATURE) {
    throw new Error("Screenshot is not a PNG.");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let seenHeader = false;
  const dataChunks: Buffer[] = [];

  for (let offset = 8; offset + 8 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error("Interlaced PNGs are not supported.");
      seenHeader = true;
    } else if (type === "IDAT") {
      dataChunks.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12; // length + type + data + CRC
  }
  if (!seenHeader) throw new Error("PNG has no IHDR chunk.");
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${String(bitDepth)}.`);
  }

  const bytesPerPixel = channelsForColorType(colorType);
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(dataChunks));
  if (raw.length < height * (stride + 1)) {
    throw new Error("Truncated PNG image data.");
  }

  const pixels = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read];
    read += 1;
    const rowStart = y * stride;
    const previousStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const left =
        x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[previousStart + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[previousStart + x - bytesPerPixel]
          : 0;
      pixels[rowStart + x] =
        unfilterByte(filter, raw[read + x], left, above, upperLeft) & 0xff;
    }
    read += stride;
  }
  return { width, height, bytesPerPixel, pixels };
}

// --- the built page, restated from `examples/character-controller` -----------

/**
 * Where the example's `vite preview` server listens. Restated from
 * `playwright.config.ts`'s `CHARACTER_PORT`; `use.baseURL` belongs to the
 * first site, so every navigation in this file is absolute.
 */
const CHARACTER_URL = "http://localhost:4182/";

/**
 * The capsule centre's height when standing on the floor (top y = 0):
 * `halfHeight + radius` = 0.85, plus the controller's 0.01 skin. The reference
 * run measured `data-py` = **0.860** at rest, exactly.
 */
const STANDING_Y = 0.86;

/** How far a measured standing height may drift from {@link STANDING_Y}. */
const STANDING_TOLERANCE = 0.05;

/**
 * The platform's top (three 0.24 risers) plus the standing offset:
 * `0.72 + 0.86` = 1.58. The reference run measured **1.580**, exactly.
 */
const PLATFORM_STANDING_Y = 1.58;

/**
 * Where the north wall stops the capsule's centre: the wall's inner face at
 * z = −3.5 plus radius 0.35 plus skin ≈ −3.14 (reference: **−3.140**). The
 * assertion only requires getting past −2.9 — clear of the platform's last
 * half-metre — and then *staying* put while W is still held, which is what
 * distinguishes "stopped by geometry" from "still walking" and from
 * "tunnelled through".
 */
const WALL_REACHED_Z = -2.9;

/**
 * How long the walk gate will wait for simulated progress before giving up.
 * 7.64 m at 3.5 m/s is 2.18 s of simulation; the timeout is wall-clock, so a
 * starved runner that drops most of §10's backlog still has room to finish
 * the walk. The previous 4 s *hold* was wall-clock too — and on CI the
 * capsule reached {@link WALL_REACHED_Z} while still sliding into the wall
 * (`|Δpz| = 0.21` over the next 500 ms). Waiting on settled `data-pz` is
 * what makes the gate measure the controller, not the container.
 */
const WALK_HOLD_TIMEOUT_SECONDS = 15;

/**
 * Consecutive *example* `update` frames (`data-frames`) of `|Δpz| ≤ 0.02`
 * that count as "stopped". Must not be Playwright rAF polls: on a starved
 * runner those can re-read the same published attribute eight times between
 * simulation steps and declare a mid-walk pose settled.
 */
const WALL_SETTLE_UPDATES = 8;

/**
 * Jump rise the gate requires, in world units above the standing height.
 *
 * The example's 4.5 m/s jump rises 1.03 m under −9.81; the reference run's
 * best *sampled* frame was +0.97 (apex frames are ~80 ms apart under
 * contention, so the true apex is rarely sampled). 0.5 requires half the
 * theoretical rise and is still ten times any settling wobble.
 */
const JUMP_RISE_MINIMUM = 0.5;

/**
 * Yaw the gate requires while → is held — now a TARGET, not a threshold.
 *
 * {@link holdUntilMoved} holds the key until yaw has moved this far, so the
 * value sets how much simulated turn the gate insists on rather than how much
 * it hopes 0.6 s will buy. The example turns at 1.6 rad/s and the reference run
 * measured **0.853**; 0.35 is a little over a third of that, so a controller
 * that turns far too slowly still fails.
 *
 * It was previously a threshold checked after a fixed 0.6 s wall-clock hold,
 * and its doc claimed 59 % margin. Run 34090671121 measured **0.133** — 6.4×
 * under the reference — because a starved rAF loop plus §10's dropped time meant
 * the simulation barely advanced. Margin does not cover starvation; waiting on
 * the simulation does.
 */
const YAW_MINIMUM = 0.35;

/** Pitch required while ↓ is held — rate 1.1 rad/s; reference **0.623**. */
const PITCH_MINIMUM = 0.25;

/**
 * Longest a look key is held while waiting for the simulation to reach its
 * target, in seconds of wall-clock.
 *
 * This is a CAP, not a dose: {@link holdUntilMoved} releases as soon as the
 * published value has moved far enough, so a fast runner is not slowed and a
 * starved one is not cut short. 10 s is deliberately far above the ~0.6 s a
 * healthy run needs — it exists to end a hung page, not to time the turn.
 */
const LOOK_HOLD_TIMEOUT_SECONDS = 10;

/**
 * Pixels that must differ between the frames before and after the yaw turn.
 *
 * A 0.85 rad swing of a 60° first-person camera replaces most of the view; the
 * reference run measured **376 941** of 518 400 changed. 50 000 is 13 % of the
 * measurement and far above anything the patroller and the settling balls
 * change on their own between two nearby frames (measured ≈ 6 100).
 */
const VIEW_SWING_MINIMUM_PIXELS = 50_000;

/**
 * Pixels whose channel sum exceeds {@link LIT_PIXEL_SUM} that a drawn frame
 * must contain. The clear colour sums to ≈ 43 and the lit floor — most of the
 * frame — to ≈ 150; the reference run counted **421 664** lit pixels of
 * 518 400. 100 000 fails only a page that drew nothing.
 */
const LIT_PIXEL_MINIMUM = 100_000;
const LIT_PIXEL_SUM = 100;

/**
 * Distance the patroller must cover in one second, in world units. It walks
 * at 1.2 m/s on a 1.33 m circle, so one second of arc is a chord of ≈ 1.1
 * (reference: **1.141**). 0.4 survives a machine that simulated only a third
 * of the second.
 */
const NPC_DRIFT_MINIMUM = 0.4;

/**
 * Seconds to wait for `data-state="running"` — one wasm image (the playground
 * gate allows the same for two). Not a performance assertion.
 */
const READY_TIMEOUT_MS = 45_000;

// --- opening the page --------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/**
 * Opens the example and returns its live error log. `favicon.ico` is served
 * rather than 404-ed, exactly as the sibling specs do it; Rapier's deprecation
 * notice arrives through `console.warn` and is not an error, so the log stays
 * empty without an allowlist.
 */
async function openExample(page: Page): Promise<ErrorLog> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.name}: ${error.message}`);
  });
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }),
  );
  await page.goto(CHARACTER_URL, { waitUntil: "load" });
  return errors;
}

/** Waits for the wasm to decode and the loop to start (§45). */
async function waitForRunning(page: Page): Promise<void> {
  await expect(page.locator("#status")).toHaveAttribute(
    "data-state",
    "running",
    { timeout: READY_TIMEOUT_MS },
  );
}

/**
 * Holds `code` until `name` has moved `minimum` away from `from`, or until
 * {@link LOOK_HOLD_TIMEOUT_SECONDS} elapses — then releases it and reports the
 * delta actually achieved.
 *
 * This used to be `keyboard.down` → `waitForTimeout(0.6s)` → `keyboard.up`, and
 * that turned `main` red on a docs-only commit (run 34090671121):
 * `yaw moved -0.133`, against a 0.35 minimum whose own doc claimed "59 % margin
 * on the measurement". The margin was never the problem. Look is integrated in
 * `fixedUpdate` as `rad/s × the injected fixed delta`, so it advances with
 * SIMULATED time — and §10's dropped-time guard throws the backlog away when the
 * rAF loop is starved. On a contended runner 0.6 real seconds bought roughly
 * 0.12 simulated ones, so the gate measured the container's spare capacity
 * rather than the controller.
 *
 * Waiting on the published value instead makes the gate independent of how fast
 * the runner happens to be: a slow machine simply takes longer in wall-clock to
 * reach the same simulated state. It still fails for every reason it is meant
 * to — no turn, a turn the wrong way, or one too slow to be usable — because the
 * wait times out and the delta is asserted afterwards either way.
 */
async function holdUntilMoved(
  page: Page,
  code: string,
  name: string,
  from: number,
  minimum: number,
): Promise<number> {
  await page.keyboard.down(code);
  try {
    await page
      .waitForFunction(
        ([field, start, target]) => {
          const element = document.querySelector<HTMLElement>("#status");
          if (element === null) return false;
          const raw = element.dataset[field];
          if (raw === undefined) return false;
          return Math.abs(Number(raw) - start) >= target;
        },
        [name, from, minimum] as const,
        { timeout: LOOK_HOLD_TIMEOUT_SECONDS * 1000 },
      )
      // A timeout is not the failure — the assertion that follows is, and it can
      // name the value it saw. Swallowing it here keeps that message.
      .catch(() => undefined);
  } finally {
    await page.keyboard.up(code);
  }
  return await readNumber(page, name);
}

async function readNumber(page: Page, name: string): Promise<number> {
  const value = await page.locator("#status").getAttribute(`data-${name}`);
  expect(value, `#status has no data-${name}`).not.toBeNull();
  const parsed = Number(value);
  expect(Number.isFinite(parsed), `data-${name}=${String(value)}`).toBe(true);
  return parsed;
}

/**
 * Holds `code` until `name ≤ maximum`, then until that value has stopped
 * changing, then takes two settled readings while the key is still down.
 *
 * Same reason as {@link holdUntilMoved}: a wall-clock `waitForTimeout` after
 * `keyboard.down` measures how much simulation the runner had spare, not
 * whether the north wall stopped the walk. CI run 34295269515 reached
 * `pz = -2.90` (the {@link WALL_REACHED_Z} threshold) and then slid another
 * 0.21 over 500 ms of real time — still walking, just late.
 */
async function holdUntilSettledAtMost(
  page: Page,
  code: string,
  name: string,
  maximum: number,
): Promise<{ first: number; second: number }> {
  await page.keyboard.down(code);
  try {
    await page
      .waitForFunction(
        ([field, target]) => {
          const element = document.querySelector<HTMLElement>("#status");
          if (element === null) return false;
          const raw = element.dataset[field];
          if (raw === undefined) return false;
          return Number(raw) <= target;
        },
        [name, maximum] as const,
        { timeout: WALK_HOLD_TIMEOUT_SECONDS * 1000 },
      )
      .catch(() => undefined);
    await waitUntilAttributeSettled(page, name);
    const first = await readNumber(page, name);
    await waitUntilAttributeSettled(page, name);
    const second = await readNumber(page, name);
    return { first, second };
  } finally {
    await page.keyboard.up(code);
  }
}

/**
 * Waits until `data-{name}` has stayed within 0.02 across
 * {@link WALL_SETTLE_UPDATES} distinct example updates (`data-frames`).
 */
async function waitUntilAttributeSettled(
  page: Page,
  name: string,
): Promise<void> {
  await page.evaluate(() => {
    delete (window as Window & { __fourSettle?: unknown }).__fourSettle;
  });
  await page
    .waitForFunction(
      ({ field, epsilon, needed }) => {
        const element = document.querySelector<HTMLElement>("#status");
        if (element === null) return false;
        const raw = element.dataset[field];
        const framesRaw = element.dataset["frames"];
        if (raw === undefined || framesRaw === undefined) return false;
        const value = Number(raw);
        const frames = Number(framesRaw);
        if (!Number.isFinite(value) || !Number.isFinite(frames)) return false;
        const store = window as Window & {
          __fourSettle?: {
            field: string;
            prev: number;
            frame: number;
            count: number;
          };
        };
        const state = store.__fourSettle;
        if (state === undefined || state.field !== field) {
          store.__fourSettle = { field, prev: value, frame: frames, count: 0 };
          return false;
        }
        if (frames === state.frame) return false;
        if (Math.abs(value - state.prev) <= epsilon) {
          state.count += 1;
        } else {
          state.count = 0;
        }
        state.prev = value;
        state.frame = frames;
        return state.count >= needed;
      },
      { field: name, epsilon: 0.02, needed: WALL_SETTLE_UPDATES },
      { timeout: WALK_HOLD_TIMEOUT_SECONDS * 1000 },
    )
    .catch(() => undefined);
}

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

/** How many pixels differ between two same-sized frames. */
function changedPixels(before: DecodedImage, after: DecodedImage): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Frames have different sizes.");
  }
  let changed = 0;
  for (let i = 0; i < before.width * before.height; i += 1) {
    const at = i * before.bytesPerPixel;
    if (
      before.pixels[at] !== after.pixels[at] ||
      before.pixels[at + 1] !== after.pixels[at + 1] ||
      before.pixels[at + 2] !== after.pixels[at + 2]
    ) {
      changed += 1;
    }
  }
  return changed;
}

/** How many pixels are brighter than the clear colour by a wide margin. */
function litPixels(image: DecodedImage): number {
  let lit = 0;
  for (let i = 0; i < image.width * image.height; i += 1) {
    const at = i * image.bytesPerPixel;
    const sum = image.pixels[at] + image.pixels[at + 1] + image.pixels[at + 2];
    if (sum > LIT_PIXEL_SUM) {
      lit += 1;
    }
  }
  return lit;
}

// --- tests -------------------------------------------------------------------

test.describe("§12: the character-controller family in the browser", () => {
  test("loads, decodes the solver, and draws the arena", async ({ page }) => {
    const errors = await openExample(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();
    await waitForRunning(page);

    // The character spawned 0.1 above the floor, fell, and grounded: the
    // engine's own account of the swept vertical resolution.
    await expect(page.locator("#status")).toHaveAttribute(
      "data-grounded",
      "true",
      { timeout: 5000 },
    );
    const py = await readNumber(page, "py");
    expect(Math.abs(py - STANDING_Y)).toBeLessThanOrEqual(STANDING_TOLERANCE);

    // …and the frame is a picture, not a cleared buffer: the lit floor alone
    // is most of the view (reference: 421 664 of 518 400 pixels lit).
    const frame = await grab(canvas);
    expect(
      litPixels(frame),
      "the canvas holds no lit scene — the arena never drew",
    ).toBeGreaterThan(LIT_PIXEL_MINIMUM);

    // A loop that throws on its first frames does so after `running`.
    await waitForFrames(page, framesFor(1));
    expect(errors).toEqual([]);
  });

  test("Space jumps: airborne, an apex, and a grounded landing (§12)", async ({
    page,
  }) => {
    const errors = await openExample(page);
    await waitForRunning(page);
    await expect(page.locator("#status")).toHaveAttribute(
      "data-grounded",
      "true",
      { timeout: 5000 },
    );
    const restY = await readNumber(page, "py");

    await page.keyboard.press("Space");
    // Sample the flight. The whole arc is 0.92 s; polling as fast as the
    // attributes can be read catches several frames near the apex.
    const deadline = Date.now() + 2000;
    let apex = restY;
    let wasAirborne = false;
    while (Date.now() < deadline) {
      const y = await readNumber(page, "py");
      if (y > apex) apex = y;
      const grounded = await page
        .locator("#status")
        .getAttribute("data-grounded");
      if (grounded === "false") wasAirborne = true;
      await waitForFrames(page, framesFor(0.04));
    }

    expect(wasAirborne, "the character never left the ground").toBe(true);
    expect(
      apex - restY,
      `the jump peaked ${(apex - restY).toFixed(2)} above rest — not a jump`,
    ).toBeGreaterThanOrEqual(JUMP_RISE_MINIMUM);

    // What goes up comes down, onto the same floor.
    await expect(page.locator("#status")).toHaveAttribute(
      "data-grounded",
      "true",
      { timeout: 3000 },
    );
    const landedY = await readNumber(page, "py");
    expect(Math.abs(landedY - restY)).toBeLessThanOrEqual(STANDING_TOLERANCE);

    expect(errors).toEqual([]);
  });

  test("W climbs the stairs by step-up and the wall stops the walk (§12, §30, §39)", async ({
    page,
  }) => {
    const errors = await openExample(page);
    await waitForRunning(page);
    await expect(page.locator("#status")).toHaveAttribute(
      "data-grounded",
      "true",
      { timeout: 5000 },
    );

    // Hold W until the capsule is past the platform and settled against the
    // north wall — all in one held key, which is the §39 pipeline end to end:
    // real keydown → intent at 100 → sweeps at 400 → solve at 600. The wait
    // is on published `data-pz`, not wall-clock: a starved runner that used
    // to sample mid-approach (`|Δpz| = 0.21`) now just takes longer.
    const { first: pzA, second: pzB } = await holdUntilSettledAtMost(
      page,
      "KeyW",
      "pz",
      WALL_REACHED_Z,
    );

    expect(
      pzA,
      `the character reached z=${pzA.toFixed(2)} — never crossed the platform`,
    ).toBeLessThanOrEqual(WALL_REACHED_Z);
    expect(pzB, "the character passed through the north wall").toBeGreaterThan(
      -3.5,
    );
    expect(
      Math.abs(pzB - pzA),
      "the character is still moving against the wall",
    ).toBeLessThanOrEqual(0.02);

    // It stands on the platform — three risers of 0.24 each — and got there
    // by the step-up, not by jumping: the reference run counted exactly 3
    // accepted step-ups and stayed grounded throughout.
    const py = await readNumber(page, "py");
    expect(
      Math.abs(py - PLATFORM_STANDING_Y),
      `standing at y=${py.toFixed(3)}, not on the platform`,
    ).toBeLessThanOrEqual(STANDING_TOLERANCE);
    const stepUps = await readNumber(page, "stepups");
    expect(
      stepUps,
      "the risers were not climbed by step-up",
    ).toBeGreaterThanOrEqual(3);
    await expect(page.locator("#status")).toHaveAttribute(
      "data-grounded",
      "true",
    );

    // Straight corridor, no strafe: X never drifted.
    const px = await readNumber(page, "px");
    expect(Math.abs(px)).toBeLessThanOrEqual(0.1);

    expect(errors).toEqual([]);
  });

  test("arrow keys write yaw and pitch, and the view swings (§44)", async ({
    page,
  }) => {
    const errors = await openExample(page);
    const canvas = page.locator("#scene");
    await waitForRunning(page);
    await expect(page.locator("#status")).toHaveAttribute(
      "data-grounded",
      "true",
      { timeout: 5000 },
    );

    const before = await grab(canvas);
    const yaw0 = await readNumber(page, "yaw");

    const yaw1 = await holdUntilMoved(page, "ArrowRight", "yaw", yaw0, YAW_MINIMUM);
    // → is −yaw: yaw is measured from +Z towards +X (§7a), so turning right
    // swings the forward axis the other way — the sign is part of the claim.
    expect(
      yaw0 - yaw1,
      `yaw moved ${(yaw1 - yaw0).toFixed(3)} — → did not turn right`,
    ).toBeGreaterThanOrEqual(YAW_MINIMUM);

    const pitch0 = await readNumber(page, "pitch");
    const pitch = await holdUntilMoved(
      page,
      "ArrowDown",
      "pitch",
      pitch0,
      PITCH_MINIMUM,
    );
    expect(
      -pitch,
      `pitch is ${pitch.toFixed(3)} — ↓ did not pitch the eye down`,
    ).toBeGreaterThanOrEqual(PITCH_MINIMUM);

    // The composition reached the screen: a first-person camera that turned
    // ~49° and pitched ~36° is looking at different geometry almost
    // everywhere (reference: 376 941 of 518 400 pixels changed).
    const after = await grab(canvas);
    expect(
      changedPixels(before, after),
      "yaw and pitch changed but the rendered view did not",
    ).toBeGreaterThan(VIEW_SWING_MINIMUM_PIXELS);

    expect(errors).toEqual([]);
  });

  test("the plane-tier patroller walks its circle while the idle player writes nothing (§12)", async ({
    page,
  }) => {
    const errors = await openExample(page);
    await waitForRunning(page);
    await expect(page.locator("#status")).toHaveAttribute(
      "data-grounded",
      "true",
      { timeout: 5000 },
    );

    const npcX0 = await readNumber(page, "npcx");
    const npcZ0 = await readNumber(page, "npcz");
    const px0 = await readNumber(page, "px");
    const pz0 = await readNumber(page, "pz");

    await waitForFrames(page, framesFor(1));

    const npcX1 = await readNumber(page, "npcx");
    const npcZ1 = await readNumber(page, "npcz");
    const drift = Math.hypot(npcX1 - npcX0, npcZ1 - npcZ0);
    expect(
      drift,
      `the patroller covered ${drift.toFixed(2)} in a second — it is not walking`,
    ).toBeGreaterThanOrEqual(NPC_DRIFT_MINIMUM);

    // The untouched player is *idle* — the swept controller's gate — so its
    // pose does not move at all: no intent, no turn, grounded, no write.
    const px1 = await readNumber(page, "px");
    const pz1 = await readNumber(page, "pz");
    expect(Math.abs(px1 - px0)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(pz1 - pz0)).toBeLessThanOrEqual(0.001);

    expect(errors).toEqual([]);
  });
});
