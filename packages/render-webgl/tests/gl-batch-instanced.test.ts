import { describe, expect, it } from "vitest";

import type { WebglContext } from "../src/gl-program.js";
import { createInstanceGl, instanceVertexSource } from "../src/index.js";

const SHADED_VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 viewProjection;
uniform mat4 model;
uniform mat3 normalMatrix;
void main() {
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

describe("instanceVertexSource (R-22)", () => {
  it("turns model and normalMatrix into per-instance attributes", () => {
    const out = instanceVertexSource(SHADED_VERTEX);
    expect(out).not.toContain("uniform mat4 model;");
    expect(out).not.toContain("uniform mat3 normalMatrix;");
    expect(out).toContain("layout(location = 8) in vec4 iModel0;");
    expect(out).toContain("layout(location = 11) in vec4 iModel3;");
    expect(out).toContain("layout(location = 12) in vec3 iNormal0;");
    expect(out).toContain("layout(location = 14) in vec3 iNormal2;");
    expect(out).toContain(
      "mat4 model = mat4(iModel0, iModel1, iModel2, iModel3);",
    );
    expect(out).toContain("uniform mat4 viewProjection;");
  });

  it("returns a source it does not recognise untouched", () => {
    const fragment = "#version 300 es\nvoid main() {}\n";
    expect(instanceVertexSource(fragment)).toBe(fragment);
    const noNormal = "uniform mat4 model;\nvoid main() {}\n";
    expect(instanceVertexSource(noNormal)).toBe(noNormal);
    const noMain = "uniform mat4 model;\nuniform mat3 normalMatrix;\n";
    expect(instanceVertexSource(noMain)).toBe(noMain);
  });
});

describe("createInstanceGl (R-22)", () => {
  function recorder(removed: boolean) {
    const calls: unknown[][] = [];
    const real = {
      tag: "real",
      shaderSource: (...args: unknown[]) => {
        calls.push(["shaderSource", ...args]);
      },
      getUniformLocation: (_program: unknown, name: string) =>
        removed && (name === "model" || name === "normalMatrix")
          ? null
          : { name },
      uniformMatrix4fv: (...args: unknown[]) => {
        calls.push(["uniformMatrix4fv", ...args]);
      },
      uniformMatrix3fv: (...args: unknown[]) => {
        calls.push(["uniformMatrix3fv", ...args]);
      },
      useProgram(this: { tag: string }, program: unknown) {
        calls.push(["useProgram", this.tag, program]);
      },
    };
    return {
      calls,
      real,
      gl: createInstanceGl(real as unknown as WebglContext),
    };
  }

  it("rewrites the vertex source it compiles", () => {
    const { calls, gl } = recorder(true);
    gl.shaderSource({}, SHADED_VERTEX);
    expect(String(calls[0][2])).toContain("iModel0");
  });

  it("resolves the removed uniforms to a placeholder whose uploads are dropped", () => {
    const { calls, gl } = recorder(true);
    const program = {};
    const model = gl.getUniformLocation(program, "model");
    const normal = gl.getUniformLocation(program, "normalMatrix");
    expect(model).not.toBeNull();
    expect(normal).not.toBeNull();
    const identity = new Float32Array(16);
    gl.uniformMatrix4fv(model as object, false, identity);
    gl.uniformMatrix3fv(normal as object, false, identity);
    expect(calls).toHaveLength(0);
    // Any other name stays null when the program lacks it.
    expect(gl.getUniformLocation(program, "missing")).toEqual({
      name: "missing",
    });
  });

  it("forwards real locations and every other call with the real receiver", () => {
    const { calls, gl, real } = recorder(false);
    const location = gl.getUniformLocation({}, "model");
    expect(location).toEqual({ name: "model" });
    gl.uniformMatrix4fv(location as object, false, new Float32Array(16));
    gl.uniformMatrix3fv(location as object, false, new Float32Array(9));
    gl.useProgram({});
    gl.useProgram({});
    expect(calls.map((call) => call[0])).toEqual([
      "uniformMatrix4fv",
      "uniformMatrix3fv",
      "useProgram",
      "useProgram",
    ]);
    expect(calls[2][1]).toBe(real.tag);
    expect((gl as unknown as { tag: string }).tag).toBe("real");
  });

  it("keeps a null for a name the program really lacks", () => {
    const real = {
      getUniformLocation: () => null,
    } as unknown as WebglContext;
    const gl = createInstanceGl(real);
    expect(gl.getUniformLocation({}, "color")).toBeNull();
  });
});
