import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TRANSFORM_AUTHORITY,
  Group,
  TRANSFORM_AUTHORITIES,
  runOwnedTransformWrite,
  warnAuthorityConflict,
  type TransformAuthority,
} from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Silences and records `console.warn` for one test. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("TransformAuthority (§42)", () => {
  it("lists exactly §42's authorities, in §42's order", () => {
    expect([...TRANSFORM_AUTHORITIES]).toEqual([
      "manual",
      "animation",
      "kinematic",
      "physics",
      "blended",
      "constraint",
      "network",
    ]);
  });

  it("types every listed value as a TransformAuthority", () => {
    // Compile-time surface check: the array's members are the union's members.
    const authorities: readonly TransformAuthority[] = TRANSFORM_AUTHORITIES;
    expect(new Set(authorities).size).toBe(TRANSFORM_AUTHORITIES.length);
  });

  it("defaults to `manual`", () => {
    expect(DEFAULT_TRANSFORM_AUTHORITY).toBe("manual");
    expect(new Group().transformAuthority).toBe("manual");
  });

  it("is per node, not shared", () => {
    const a = new Group();
    const b = new Group();
    a.transformAuthority = "physics";
    expect(a.transformAuthority).toBe("physics");
    expect(b.transformAuthority).toBe("manual");
  });

  it("accepts every authority, in any order", () => {
    const node = new Group();
    for (const authority of TRANSFORM_AUTHORITIES) {
      node.transformAuthority = authority;
      expect(node.transformAuthority).toBe(authority);
    }
  });
});

describe("`blended` is assignable since WP-7.3 (§42, §19)", () => {
  it("assigns like every other authority, throwing nothing", () => {
    const node = new Group();
    expect(() => {
      node.transformAuthority = "blended";
    }).not.toThrow();
    expect(node.transformAuthority).toBe("blended");
  });

  it("is a plain field: assigning it back is not a special case", () => {
    const node = new Group();
    node.transformAuthority = "animation";
    node.transformAuthority = "blended";
    expect(node.transformAuthority).toBe("blended");
    node.transformAuthority = "animation";
    expect(node.transformAuthority).toBe("animation");
  });

  it("touches nothing else on the node", () => {
    const node = new Group();
    const version = node.transform.version;
    node.transformAuthority = "blended";
    expect(node.transform.version).toBe(version);
  });

  /*
   * The trio §19 needs — "blended" authority, a RigidBody registered with a
   * PhysicsWorld, and a PoseTarget — cannot be checked here: `@fourjs/scene`
   * knows nothing about worlds or bodies. `@fourjs/physics`'s
   * `tests/world-blend.test.ts` owns that enforcement, and this test only pins
   * the half `Node` is responsible for: the value assigns.
   */
});

describe("warnAuthorityConflict (§42 development warning)", () => {
  it("warns once per node per writer", () => {
    const warn = spyOnWarn();
    const node = new Group();

    expect(warnAuthorityConflict(node, "kinematic")).toBe(true);
    expect(warnAuthorityConflict(node, "kinematic")).toBe(false);
    expect(warnAuthorityConflict(node, "kinematic")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns again for a different writer on the same node", () => {
    const warn = spyOnWarn();
    const node = new Group();

    expect(warnAuthorityConflict(node, "kinematic")).toBe(true);
    expect(warnAuthorityConflict(node, "physics")).toBe(true);
    expect(warnAuthorityConflict(node, "kinematic")).toBe(false);
    expect(warnAuthorityConflict(node, "physics")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warns again for the same writer on a different node", () => {
    const warn = spyOnWarn();
    const a = new Group();
    const b = new Group();

    expect(warnAuthorityConflict(a, "animation")).toBe(true);
    expect(warnAuthorityConflict(b, "animation")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("names the node, the owner, and the offending writer", () => {
    const warn = spyOnWarn();
    const node = new Group();
    node.name = "crate";
    node.transformAuthority = "physics";

    warnAuthorityConflict(node, "kinematic");

    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("[fourJS]");
    expect(message.indexOf("[fourJS]")).toBe(message.lastIndexOf("[fourJS]"));
    expect(message).toContain(node.id);
    expect(message).toContain("crate");
    expect(message).toContain('"physics"');
    expect(message).toContain('"kinematic"');
    expect(message).toContain("§42");
  });

  it("omits the name when a node has none", () => {
    const warn = spyOnWarn();
    const node = new Group();

    warnAuthorityConflict(node, "network");

    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain(node.id);
    expect(message).not.toContain('("")');
  });

  it("never touches the node it reports on", () => {
    spyOnWarn();
    const node = new Group();
    node.transformAuthority = "physics";
    const version = node.transform.version;

    warnAuthorityConflict(node, "kinematic");

    expect(node.transformAuthority).toBe("physics");
    expect(node.transform.version).toBe(version);
    expect(node.transform.position.x).toBe(0);
  });
});

describe("application writes on a system-owned transform (§42 DEV)", () => {
  it("does not warn when the owner is manual", () => {
    const warn = spyOnWarn();
    const node = new Group();
    node.position.set(1, 2, 3);
    expect(warn).not.toHaveBeenCalled();
    expect(node.position.x).toBe(1);
  });

  it("warns once, and still applies the write, when the owner is not manual", () => {
    const warn = spyOnWarn();
    const node = new Group();
    node.transformAuthority = "kinematic";
    node.position.set(999, 0, 0);
    expect(node.position.x).toBe(999);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "the write was applied",
    );
    node.position.set(1000, 0, 0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(node.position.x).toBe(1000);
  });

  it("is silent inside runOwnedTransformWrite", () => {
    const warn = spyOnWarn();
    const node = new Group();
    node.transformAuthority = "kinematic";
    runOwnedTransformWrite(() => {
      node.position.set(4, 5, 6);
    });
    expect(warn).not.toHaveBeenCalled();
    expect(node.position.x).toBe(4);
  });

  it("is silent when __FOUR_DEV__ is false", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const { Group } = await import("../src/group.js");
    const warn = spyOnWarn();
    const node = new Group();
    node.transformAuthority = "physics";
    node.position.set(7, 8, 9);
    expect(warn).not.toHaveBeenCalled();
    expect(node.position.x).toBe(7);
  });
});
