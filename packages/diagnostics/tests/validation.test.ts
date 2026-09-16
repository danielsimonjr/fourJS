import { afterEach, describe, expect, it, vi } from "vitest";

import { FourError, resetDevWarnings } from "@fourjs/core";
import { Group } from "@fourjs/scene";

import {
  COORDINATE_ENVELOPE,
  NEAR_ZERO_SCALE,
  UNSTABLE_SCALE_RATIO,
  assertFinite,
  assertFiniteVec3,
  assertNoSceneGraphCycle,
  validateSceneNode,
  validateSceneSubtree,
  warnCoordinateEnvelope,
  warnImpossibleInertia,
  warnImpossibleMass,
  warnSingularScale,
  warnUnstableScale,
  warnVersionMismatch,
} from "../src/validation.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetDevWarnings();
});

describe("validation catalogue", () => {
  it("warnCoordinateEnvelope fires once beyond the §41 envelope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      warnCoordinateEnvelope(
        { x: COORDINATE_ENVELOPE + 1, y: 0, z: 0 },
        "node test",
      ),
    ).toBe(true);
    expect(
      warnCoordinateEnvelope(
        { x: COORDINATE_ENVELOPE + 2, y: 0, z: 0 },
        "node test",
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("assertFinite throws FourError in development", () => {
    expect(() => assertFinite(Number.NaN, "mass")).toThrow(FourError);
  });

  it("assertFiniteVec3 throws when a component is not finite", () => {
    expect(() =>
      assertFiniteVec3({ x: 1, y: Number.NaN, z: 0 }, "position"),
    ).toThrow(FourError);
  });

  it("assertFiniteVec3 accepts a finite vector", () => {
    expect(() =>
      assertFiniteVec3({ x: 1, y: 2, z: 3 }, "position"),
    ).not.toThrow();
  });

  it("warnImpossibleMass fires for negative and non-finite mass", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnImpossibleMass(-1, "body")).toBe(true);
    expect(warnImpossibleMass(Number.NaN, "body-nan")).toBe(true);
    expect(warnImpossibleMass(Number.POSITIVE_INFINITY, "body-inf")).toBe(true);
    expect(warnImpossibleMass(1, "body-ok")).toBe(false);
    expect(warnImpossibleMass(0, "body-zero")).toBe(false);
    expect(warnImpossibleMass(-2, "body", { enabled: false })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("warnImpossibleInertia fires for negative and non-finite inertia", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnImpossibleInertia(-0.5, "body")).toBe(true);
    expect(warnImpossibleInertia(Number.NaN, "body-nan")).toBe(true);
    expect(warnImpossibleInertia(2, "body-ok")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warnVersionMismatch fires when versions differ", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnVersionMismatch(2, 1, "scene")).toBe(true);
    expect(warnVersionMismatch(2, 1, "scene")).toBe(false);
    expect(warnVersionMismatch(2, 2, "scene-ok")).toBe(false);
    expect(warnVersionMismatch("1.0", "0.9", "doc", { enabled: false })).toBe(
      false,
    );
    const text = String(warn.mock.calls[0]?.[0]);
    expect(text).toContain("expected 2");
    expect(text).toContain("got 1");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("assertNoSceneGraphCycle refuses a descendant parent link", () => {
    const root = new Group();
    const child = new Group();
    root.add(child);
    expect(() => assertNoSceneGraphCycle(child, root)).toThrow(FourError);
  });

  it("assertNoSceneGraphCycle refuses adding a node to itself", () => {
    const node = new Group();
    expect(() => assertNoSceneGraphCycle(node, node)).toThrow(FourError);
  });

  it("warnCoordinateEnvelope stays quiet inside the envelope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnCoordinateEnvelope({ x: 1, y: 2, z: 3 }, "near origin")).toBe(
      false,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("warnSingularScale fires on a zero component", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnSingularScale({ x: 1, y: 0, z: 1 }, "node scale")).toBe(true);
    expect(warnSingularScale({ x: 1, y: 1, z: 1 }, "node scale")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warnUnstableScale fires on extreme and near-zero ratios", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      warnUnstableScale({ x: UNSTABLE_SCALE_RATIO + 1, y: 1, z: 1 }, "extreme"),
    ).toBe(true);
    expect(
      warnUnstableScale({ x: 1, y: NEAR_ZERO_SCALE / 2, z: 1 }, "microscopic"),
    ).toBe(true);
    expect(warnUnstableScale({ x: 1, y: 1, z: 1 }, "balanced")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("validateSceneNode and validateSceneSubtree count warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const root = new Group();
    root.transform.scale.set(0, 1, 1);
    const child = new Group();
    child.transform.position.set(COORDINATE_ENVELOPE + 10, 0, 0);
    root.add(child);
    expect(validateSceneNode(root)).toBe(2);
    resetDevWarnings();
    expect(validateSceneSubtree(root)).toBe(3);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("validateSceneNode asserts finite transform components", () => {
    const node = new Group();
    node.transform.position.set(Number.NaN, 0, 0);
    expect(() => validateSceneNode(node)).toThrow(FourError);
  });

  it("validateSceneSubtree refuses a cyclic graph", () => {
    const transform = {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    type NodeMock = {
      id: string;
      parent: NodeMock | null;
      children: NodeMock[];
      transform: typeof transform;
    };
    const a: NodeMock = { id: "a", parent: null, children: [], transform };
    const b: NodeMock = { id: "b", parent: a, children: [a], transform };
    a.children = [b];
    expect(() => validateSceneSubtree(a)).toThrow(FourError);
  });

  it("validateSceneSubtree stops walking a cycle when the check is disabled", () => {
    const transform = {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    type NodeMock = {
      id: string;
      parent: NodeMock | null;
      children: NodeMock[];
      transform: typeof transform;
    };
    const a: NodeMock = { id: "a", parent: null, children: [], transform };
    const b: NodeMock = { id: "b", parent: a, children: [a], transform };
    a.children = [b];
    expect(
      validateSceneSubtree(a, { sceneGraphCycle: { enabled: false } }),
    ).toBe(0);
  });

  it("is inert in a production build", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const production = await import("../src/validation.js");
    expect(production.warnCoordinateEnvelope({ x: 1e6, y: 0, z: 0 }, "n")).toBe(
      false,
    );
    expect(production.warnImpossibleMass(-1, "x")).toBe(false);
    expect(production.warnImpossibleInertia(-1, "x")).toBe(false);
    expect(production.warnVersionMismatch(1, 2, "x")).toBe(false);
    expect(() =>
      production.assertFiniteVec3({ x: Number.NaN, y: 0, z: 0 }, "p"),
    ).not.toThrow();
    expect(production.validateSceneSubtree(new Group())).toBe(0);
  });
});
