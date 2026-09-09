import { describe, expect, test } from "bun:test"
import { BAMBU_DOWNLOAD, bambuCandidates, bambuTargets } from "./bambu"

describe("bambuCandidates", () => {
  test("an explicit override wins outright", () => {
    expect(bambuCandidates({ CODER3D_BAMBU_STUDIO: "D:/slicers/bambu-studio.exe" })).toEqual([
      "D:/slicers/bambu-studio.exe",
    ])
  })

  test("covers the same install locations print-mcp probes", () => {
    // These must agree with print-mcp/src/coder3d_print/slicer.py _CANDIDATES,
    // or the app offers to open a slicer the print lane cannot drive.
    const candidates = bambuCandidates({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" })
    expect(candidates).toContain("C:\\Program Files\\Bambu Studio\\bambu-studio.exe")
    expect(candidates).toContain("C:\\Program Files (x86)\\Bambu Studio\\bambu-studio.exe")
    expect(candidates.some((c) => c.includes("AppData") && c.includes("Bambu Studio"))).toBe(true)
  })

  test("no LOCALAPPDATA does not produce a path with undefined in it", () => {
    expect(bambuCandidates({}).every((c) => !c.includes("undefined"))).toBe(true)
  })
})

describe("BAMBU_DOWNLOAD", () => {
  test("points at Bambu's own download page", () => {
    // The button is the install route when the slicer is missing, so this has
    // to be somewhere a lab operator can actually get it.
    expect(BAMBU_DOWNLOAD).toContain("bambulab.com")
    expect(BAMBU_DOWNLOAD.startsWith("https://")).toBe(true)
  })
})

describe("bambuTargets", () => {
  test("a sliced job opens itself", () => {
    expect(bambuTargets("cases/k/prints/cuff.gcode.3mf")).toEqual(["cases/k/prints/cuff.gcode.3mf"])
  })

  test("a mesh opens the 3mf written beside it", () => {
    // Every CAD build now exports one, and it is the file a slicer wants —
    // handing Bambu a .glb would be the wrong format for the job.
    expect(bambuTargets("cases/k/meshes/assembly.glb")).toEqual(["cases/k/meshes/assembly.3mf"])
    expect(bambuTargets("cases/k/meshes/assembly.stl")).toEqual(["cases/k/meshes/assembly.3mf"])
  })

  test("a project 3mf is already the right file", () => {
    expect(bambuTargets("cases/k/meshes/assembly.3mf")).toEqual(["cases/k/meshes/assembly.3mf"])
  })
})
