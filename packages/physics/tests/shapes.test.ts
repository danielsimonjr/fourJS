import { isFourError } from "@fourjs/core";
import { Vector2, Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import type { CollisionShape } from "../src/shapes.js";
import { MAXIMUM_SHAPE_POINTS } from "../src/shapes.js";
import {
  COLLISION_SHAPE_TYPES_2D,
  COLLISION_SHAPE_TYPES_3D,
  COMPOSITE_COLLISION_SHAPE_TYPES,
  shapeIsConvex,
  shapeSupportsDimension,
  validateCollisionShape,
  validateQueryShape,
} from "../src/shapes.js";

/** Asserts that `run` throws a `FourError` with the §89 invalid-input code. */
function expectFourError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as Error & { code: string };
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

const circle: CollisionShape = { type: "circle", radius: 1 };
const rectangle: CollisionShape = {
  type: "rectangle",
  halfExtents: new Vector2(1, 2),
};
const capsule: CollisionShape = { type: "capsule", radius: 0.5, halfHeight: 1 };
const squareVertices = [
  new Vector2(0, 0),
  new Vector2(1, 0),
  new Vector2(1, 1),
  new Vector2(0, 1),
];
const square: CollisionShape = { type: "polygon", vertices: squareVertices };
const sphere: CollisionShape = { type: "sphere", radius: 1 };
const box: CollisionShape = { type: "box", halfExtents: new Vector3(1, 2, 3) };
const polyline: CollisionShape = {
  type: "polyline",
  vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1)],
};
const chain: CollisionShape = { type: "chain", vertices: squareVertices };
const cylinder: CollisionShape = {
  type: "cylinder",
  radius: 0.5,
  halfHeight: 1,
};
const cone: CollisionShape = { type: "cone", radius: 0.5, halfHeight: 1 };
const hull: CollisionShape = {
  type: "convex-hull",
  points: [
    new Vector3(0, 0, 0),
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ],
};
const triangleMeshVertices = [
  new Vector3(0, 0, 0),
  new Vector3(1, 0, 0),
  new Vector3(0, 0, 1),
];
const triangleMesh: CollisionShape = {
  type: "triangle-mesh",
  vertices: triangleMeshVertices,
  indices: [0, 1, 2],
};
const heightField: CollisionShape = {
  type: "height-field",
  rows: 2,
  columns: 2,
  heights: [0, 1, 2, 3],
  scale: new Vector3(2, 1, 2),
};

describe("§24 shape list (PH-22a)", () => {
  it("lists exactly the shipped shape tags", () => {
    expect(COLLISION_SHAPE_TYPES_2D).toEqual([
      "circle",
      "rectangle",
      "capsule",
      "polygon",
      "polyline",
      "chain",
    ]);
    expect(COLLISION_SHAPE_TYPES_3D).toEqual([
      "sphere",
      "box",
      "capsule",
      "cylinder",
      "cone",
      "convex-hull",
      "triangle-mesh",
      "height-field",
    ]);
  });

  it("covers §24's list except compound, which is composition", () => {
    // §24 lists seven 2D shapes and nine 3D ones; `compound` is the one entry
    // in each list that is not a shape but several colliders on one body
    // (PH-22a decision), so the tags are one short of §24's counts.
    expect(COLLISION_SHAPE_TYPES_2D).toHaveLength(6);
    expect(COLLISION_SHAPE_TYPES_3D).toHaveLength(8);

    // @ts-expect-error - §24's "compound" is deliberately not a shape tag.
    const compound: CollisionShape = { type: "compound", children: [] };
    expect(compound).toBeDefined();
  });

  it("names the four composite shapes, and only those", () => {
    expect(COMPOSITE_COLLISION_SHAPE_TYPES).toEqual([
      "polyline",
      "chain",
      "triangle-mesh",
      "height-field",
    ]);
    for (const shape of [polyline, chain, triangleMesh, heightField]) {
      expect(shapeIsConvex(shape)).toBe(false);
    }
    for (const shape of [circle, square, sphere, cylinder, cone, hull]) {
      expect(shapeIsConvex(shape)).toBe(true);
    }
  });

  it("rejects an unknown tag that reaches the validator from JavaScript", () => {
    const error = expectFourError(() => {
      validateCollisionShape({ type: "voxels" } as unknown as CollisionShape);
    });
    expect(error.message).toContain("Unknown collision shape");
  });
});

describe("validateQueryShape (§30, PH-22a)", () => {
  it("accepts every convex shape in its own dimension", () => {
    for (const shape of [circle, rectangle, capsule, square]) {
      expect(() => {
        validateQueryShape(shape, "2d");
      }).not.toThrow();
    }
    for (const shape of [sphere, box, cylinder, cone, hull]) {
      expect(() => {
        validateQueryShape(shape, "3d");
      }).not.toThrow();
    }
  });

  it("refuses each composite shape, naming the reason", () => {
    for (const [shape, dimension] of [
      [polyline, "2d"],
      [chain, "2d"],
      [triangleMesh, "3d"],
      [heightField, "3d"],
    ] as const) {
      const error = expectFourError(() => {
        validateQueryShape(shape, dimension);
      });
      expect(error.message).toContain("boundary but no interior");
    }
  });

  it("still runs the ordinary shape validation first", () => {
    // A malformed convex shape fails as a shape, not as a query shape.
    expect(
      expectFourError(() => {
        validateQueryShape({ type: "sphere", radius: 0 }, "3d");
      }).message,
    ).toContain("radius must be a finite positive number");
    // …and the dimension check still comes before the convexity one, so a 2D
    // composite shape in a 3D world reports the dimension.
    expect(
      expectFourError(() => {
        validateQueryShape(polyline, "3d");
      }).message,
    ).toContain('not valid in a "3d" world');
  });
});

describe("polyline and chain (§24, PH-22a)", () => {
  it("accepts an open run of two vertices and a closed run of three", () => {
    expect(() => {
      validateCollisionShape(
        { type: "polyline", vertices: [new Vector2(0, 0), new Vector2(1, 0)] },
        "2d",
      );
    }).not.toThrow();
    expect(() => {
      validateCollisionShape(chain, "2d");
    }).not.toThrow();
  });

  it("accepts a concave outline, which is the point of both", () => {
    const concave = [
      new Vector2(0, 0),
      new Vector2(2, 0),
      new Vector2(1, 1),
      new Vector2(2, 2),
      new Vector2(0, 2),
    ];
    expect(() => {
      validateCollisionShape({ type: "polyline", vertices: concave }, "2d");
    }).not.toThrow();
    expect(() => {
      validateCollisionShape({ type: "chain", vertices: concave }, "2d");
    }).not.toThrow();
    // The same outline as a polygon is refused, and says which to use instead.
    expect(
      expectFourError(() => {
        validateCollisionShape({ type: "polygon", vertices: concave }, "2d");
      }).message,
    ).toContain("polyline (open) and chain (closed)");
  });

  it("rejects too few vertices, with each shape's own minimum", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polyline",
          vertices: [new Vector2(0, 0)],
        });
      }).message,
    ).toContain("at least 2 vertices");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "chain",
          vertices: [new Vector2(0, 0), new Vector2(1, 0)],
        });
      }).message,
    ).toContain("at least 3 vertices");
  });

  it("rejects a non-finite vertex", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polyline",
          vertices: [new Vector2(0, 0), new Vector2(Number.NaN, 0)],
        });
      }).message,
    ).toContain("vertex 1 must be finite");
  });

  it("rejects a zero-length segment, including a chain's closing one", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polyline",
          vertices: [new Vector2(0, 0), new Vector2(0, 0)],
        });
      }).message,
    ).toContain("zero-length segment");
    // A polyline does NOT close, so a repeated first/last vertex is legal…
    expect(() => {
      validateCollisionShape({
        type: "polyline",
        vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 0)],
      });
    }).not.toThrow();
    // …and the same run as a chain is not, because the closing segment is
    // vertex 2 back to vertex 0.
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "chain",
          vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 0)],
        });
      }).message,
    ).toContain("vertices 2 and 0");
  });
});

describe("cylinder and cone (§24, PH-22a)", () => {
  it("accepts positive radius and half height in 3D only", () => {
    for (const shape of [cylinder, cone]) {
      expect(shapeSupportsDimension(shape, "3d")).toBe(true);
      expect(shapeSupportsDimension(shape, "2d")).toBe(false);
    }
  });

  it("rejects a non-positive radius or half height", () => {
    for (const type of ["cylinder", "cone"] as const) {
      expect(
        expectFourError(() => {
          validateCollisionShape({ type, radius: 0, halfHeight: 1 });
        }).message,
      ).toContain("radius");
      expect(
        expectFourError(() => {
          validateCollisionShape({ type, radius: 1, halfHeight: -1 });
        }).message,
      ).toContain("halfHeight");
    }
  });
});

describe("convex-hull (§24, PH-22a)", () => {
  it("accepts four or more finite points", () => {
    expect(() => {
      validateCollisionShape(hull, "3d");
    }).not.toThrow();
  });

  it("rejects fewer than four points", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "convex-hull",
          points: [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
        });
      }).message,
    ).toContain("at least 4 points");
  });

  it("rejects a non-finite point", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "convex-hull",
          points: [
            new Vector3(),
            new Vector3(1, 0, 0),
            new Vector3(0, 1, 0),
            new Vector3(0, 0, Number.POSITIVE_INFINITY),
          ],
        });
      }).message,
    ).toContain("point 3 must be finite");
  });
});

describe("triangle-mesh (§24, PH-22a)", () => {
  it("accepts a well-formed mesh", () => {
    expect(() => {
      validateCollisionShape(triangleMesh, "3d");
    }).not.toThrow();
  });

  it("rejects fewer than three vertices", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "triangle-mesh",
          vertices: [new Vector3(), new Vector3(1, 0, 0)],
          indices: [0, 1, 0],
        });
      }).message,
    ).toContain("at least 3 vertices");
  });

  it("rejects a non-finite vertex", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "triangle-mesh",
          vertices: [
            new Vector3(),
            new Vector3(1, 0, 0),
            new Vector3(0, Number.NaN, 0),
          ],
          indices: [0, 1, 2],
        });
      }).message,
    ).toContain("vertex 2 must be finite");
  });

  it("rejects an index count that is not a positive multiple of three", () => {
    for (const indices of [[], [0, 1, 2, 0]]) {
      expect(
        expectFourError(() => {
          validateCollisionShape({
            type: "triangle-mesh",
            vertices: triangleMeshVertices,
            indices,
          });
        }).message,
      ).toContain("positive multiple of 3");
    }
  });

  it("rejects an index that is out of range or not an integer", () => {
    for (const bad of [3, -1, 1.5, Number.NaN]) {
      expect(
        expectFourError(() => {
          validateCollisionShape({
            type: "triangle-mesh",
            vertices: triangleMeshVertices,
            indices: [0, 1, bad],
          });
        }).message,
      ).toContain("index 2 is");
    }
  });
});

describe("height-field (§24, PH-22a)", () => {
  it("accepts a well-formed grid", () => {
    expect(() => {
      validateCollisionShape(heightField, "3d");
    }).not.toThrow();
  });

  it("rejects a grid narrower than 2×2, or a non-integer count", () => {
    for (const [rows, columns, field] of [
      [1, 2, "rows"],
      [2, 1, "columns"],
      [2.5, 2, "rows"],
    ] as const) {
      expect(
        expectFourError(() => {
          validateCollisionShape({
            type: "height-field",
            rows,
            columns,
            heights: [0, 0, 0, 0],
            scale: new Vector3(1, 1, 1),
          });
        }).message,
      ).toContain(`${field} must be an integer ≥ 2`);
    }
  });

  it("rejects a heights array that is not rows × columns long", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "height-field",
          rows: 2,
          columns: 3,
          heights: [0, 0, 0, 0],
          scale: new Vector3(1, 1, 1),
        });
      }).message,
    ).toContain("rows × columns = 6");
  });

  it("rejects a non-finite height", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "height-field",
          rows: 2,
          columns: 2,
          heights: [0, 0, Number.NaN, 0],
          scale: new Vector3(1, 1, 1),
        });
      }).message,
    ).toContain("height 2 must be finite");
  });

  it("rejects a non-positive scale on any axis", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "height-field",
          rows: 2,
          columns: 2,
          heights: [0, 0, 0, 0],
          scale: new Vector3(1, 1, 0),
        });
      }).message,
    ).toContain("scale.z");
  });
});

describe("shapeSupportsDimension (§21, §24)", () => {
  it("places each 2D shape in 2D only", () => {
    for (const shape of [circle, rectangle, square]) {
      expect(shapeSupportsDimension(shape, "2d")).toBe(true);
      expect(shapeSupportsDimension(shape, "3d")).toBe(false);
    }
  });

  it("places each 3D shape in 3D only", () => {
    for (const shape of [sphere, box]) {
      expect(shapeSupportsDimension(shape, "3d")).toBe(true);
      expect(shapeSupportsDimension(shape, "2d")).toBe(false);
    }
  });

  it("accepts a capsule in both dimensions", () => {
    expect(shapeSupportsDimension(capsule, "2d")).toBe(true);
    expect(shapeSupportsDimension(capsule, "3d")).toBe(true);
  });
});

describe("validateCollisionShape — dimensions (§21)", () => {
  it("accepts every shipped shape in its own dimension", () => {
    for (const shape of [circle, rectangle, capsule, square]) {
      expect(() => {
        validateCollisionShape(shape, "2d");
      }).not.toThrow();
    }
    for (const shape of [sphere, box, capsule]) {
      expect(() => {
        validateCollisionShape(shape, "3d");
      }).not.toThrow();
    }
  });

  it("accepts any shipped shape when no dimension is given", () => {
    expect(() => {
      validateCollisionShape(circle);
    }).not.toThrow();
    expect(() => {
      validateCollisionShape(sphere);
    }).not.toThrow();
  });

  it("rejects a circle in a 3d world and a sphere in a 2d world", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape(circle, "3d");
      }).message,
    ).toContain('not valid in a "3d" world');
    expect(
      expectFourError(() => {
        validateCollisionShape(sphere, "2d");
      }).message,
    ).toContain('not valid in a "2d" world');
  });
});

describe("validateCollisionShape — parameters (§24, §85)", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a circle radius of %s",
    (radius) => {
      expectFourError(() => {
        validateCollisionShape({ type: "circle", radius });
      });
    },
  );

  it("rejects a non-positive sphere radius", () => {
    expectFourError(() => {
      validateCollisionShape({ type: "sphere", radius: 0 });
    });
  });

  it("rejects non-positive rectangle half extents on either axis", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "rectangle",
          halfExtents: new Vector2(0, 1),
        });
      }).message,
    ).toContain("halfExtents.x");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "rectangle",
          halfExtents: new Vector2(1, -2),
        });
      }).message,
    ).toContain("halfExtents.y");
  });

  it("rejects non-positive box half extents on any axis", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "box",
          halfExtents: new Vector3(0, 1, 1),
        });
      }).message,
    ).toContain("halfExtents.x");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "box",
          halfExtents: new Vector3(1, 0, 1),
        });
      }).message,
    ).toContain("halfExtents.y");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "box",
          halfExtents: new Vector3(1, 1, Number.NaN),
        });
      }).message,
    ).toContain("halfExtents.z");
  });

  it("rejects a capsule with a non-positive radius or half height", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({ type: "capsule", radius: 0, halfHeight: 1 });
      }).message,
    ).toContain("radius");
    expect(
      expectFourError(() => {
        validateCollisionShape({ type: "capsule", radius: 1, halfHeight: 0 });
      }).message,
    ).toContain("halfHeight");
  });
});

describe("validateCollisionShape — polygons (§24, §85)", () => {
  it("accepts a convex polygon in either winding", () => {
    expect(() => {
      validateCollisionShape(square, "2d");
    }).not.toThrow();
    expect(() => {
      validateCollisionShape({
        type: "polygon",
        vertices: [...squareVertices].reverse(),
      });
    }).not.toThrow();
  });

  it("tolerates a collinear (redundant) vertex", () => {
    expect(() => {
      validateCollisionShape({
        type: "polygon",
        vertices: [
          new Vector2(0, 0),
          new Vector2(1, 0),
          new Vector2(2, 0),
          new Vector2(2, 1),
          new Vector2(0, 1),
        ],
      });
    }).not.toThrow();
  });

  it("rejects fewer than three vertices", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(1, 0)],
        });
      }).message,
    ).toContain("at least 3 vertices");
  });

  it("rejects a non-finite vertex", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [
            new Vector2(0, 0),
            new Vector2(Number.NaN, 0),
            new Vector2(1, 1),
          ],
        });
      }).message,
    ).toContain("vertex 1");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [
            new Vector2(0, 0),
            new Vector2(1, Number.POSITIVE_INFINITY),
            new Vector2(1, 1),
          ],
        });
      }).message,
    ).toContain("vertex 1");
  });

  it("rejects a zero-length edge from two identical vertices", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(0, 0), new Vector2(1, 1)],
        });
      }).message,
    ).toContain("zero-length edge");
  });

  it("rejects a concave outline and names the staged alternatives", () => {
    const error = expectFourError(() => {
      validateCollisionShape({
        type: "polygon",
        vertices: [
          new Vector2(0, 0),
          new Vector2(2, 0),
          new Vector2(2, 2),
          new Vector2(1, 1),
          new Vector2(0, 2),
        ],
      });
    });
    expect(error.message).toContain("not convex");
    expect(error.message).toContain("polyline");
  });

  it("rejects an outline whose vertices are all collinear", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(2, 0)],
        });
      }).message,
    ).toContain("encloses no area");
  });
});

describe("shape point ceiling (§96, 2026-09-11)", () => {
  it("refuses a triangle mesh with more than MAXIMUM_SHAPE_POINTS vertices", () => {
    const vertices = new Array<[number, number, number]>(MAXIMUM_SHAPE_POINTS + 1).fill([0, 0, 0]);
    expect(() =>
      validateCollisionShape({ type: "triangle-mesh", vertices, indices: [0, 1, 2] } as never),
    ).toThrowError(expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }) as Error);
  });
});
