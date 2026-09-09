import { describe, expect, test } from "bun:test"
import { classifyChange } from "./core"

describe("classifyChange", () => {
  test("cad scripts and param files are sources", () => {
    expect(classifyChange("cases/a/cad/rack.py")).toBe("source")
    expect(classifyChange("cases\\a\\cad\\rack.params.json")).toBe("source")
  })
  test("manifest writes never re-trigger runs", () => {
    expect(classifyChange("cases/a/cad/rack.manifest.json")).toBe("artifact")
  })
  test("meshes reload the view", () => {
    expect(classifyChange("cases/a/meshes/rack.stl")).toBe("artifact")
    expect(classifyChange("cases/a/meshes/rack.glb")).toBe("artifact")
    expect(classifyChange("cases/a/cad/rack.step")).toBe("artifact")
  })
  test("build dir is inert except renders", () => {
    expect(classifyChange("cases/a/.coder3d/tmp.bin")).toBeNull()
    expect(classifyChange("cases/a/.coder3d/tmp.json")).toBeNull()
    expect(classifyChange("cases/a/.coder3d/renders/rack-iso.png")).toBe("artifact")
  })
  test("noise is ignored", () => {
    expect(classifyChange(".git/objects/aa")).toBeNull()
    expect(classifyChange("node_modules/x/y.js")).toBeNull()
    expect(classifyChange("cases/a/notes.md")).toBeNull()
  })
})
