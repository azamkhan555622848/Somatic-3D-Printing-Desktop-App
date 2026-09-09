import { describe, expect, test } from "bun:test"
import {
  artifactInCase,
  buildCaseSummaries,
  caseIDForPath,
  filterCaseSummaries,
  firstArtifactPath,
  firstScanPath,
  friendlyName,
  parseGateStatus,
} from "./case-browser"

const files = [
  "cases/.identity/demo.json",
  "cases/demo-ct/dicom/00000.dcm",
  "cases/demo-ct/dicom/00001.dcm",
  "cases/demo-ct/nifti/_545152811.nii.gz",
  "cases/demo-ct/segmentations/_545152811/liver.nii.gz",
  "cases/demo-ct/meshes/liver.stl",
  "cases/demo-ct/meshes/liver.glb",
  "cases/demo-ct/meshes/qa/liver.gate.json",
  "cases/demo-ct/provenance.json",
  "cases/tube-rack/cad/tube_rack.py",
  "cases/tube-rack/meshes/tube_rack.stl",
  "cases/tube-rack/.coder3d/renders/tube-rack.png",
]

describe("buildCaseSummaries", () => {
  test("turns case folders into a friendly artifact model", () => {
    const cases = buildCaseSummaries(files)
    expect(cases.map((item) => item.name)).toEqual(["Demo CT", "Tube Rack"])
    expect(cases[0].dicomCount).toBe(2)
    expect(cases[0].artifacts.map((item) => [item.kind, item.name, item.badges])).toEqual([
      ["scan", "Demo CT", ["NIfTI"]],
      ["segmentation", "Liver", ["SEG"]],
      ["model", "Liver", ["GLB", "STL"]],
      ["qa", "Liver", ["QA"]],
    ])
    expect(cases[0].artifacts.find((item) => item.kind === "model")?.path).toEndWith("liver.glb")
  })

  test("a 3mf beside the stl/glb merges into the model row, prints get their own", () => {
    // The CAD runner exports meshes/<part>.3mf for Bambu Studio alongside
    // stl/glb; sliced jobs land in prints/. Both must be visible.
    const cases = buildCaseSummaries([
      "cases/knee-brace/meshes/cuff.stl",
      "cases/knee-brace/meshes/cuff.glb",
      "cases/knee-brace/meshes/cuff.3mf",
      "cases/knee-brace/prints/cuff.gcode.3mf",
    ])
    expect(cases[0].artifacts.map((item) => [item.kind, item.badges])).toEqual([
      ["model", ["GLB", "STL", "3MF"]],
      ["print", ["3MF"]],
    ])
  })

  test("never exposes protected metadata as a case", () => {
    const serialized = JSON.stringify(buildCaseSummaries(files))
    expect(serialized).not.toContain(".identity")
    expect(serialized).not.toContain(".coder3d")
  })
})

describe("case browser helpers", () => {
  test("formats identifiers and resolves case ids", () => {
    expect(friendlyName("demo-ct")).toBe("Demo CT")
    expect(friendlyName("tube_rack")).toBe("Tube Rack")
    expect(caseIDForPath("cases/demo-ct/meshes/liver.glb")).toBe("demo-ct")
    expect(caseIDForPath("notes.txt")).toBeUndefined()
  })

  test("filters by case, artifact, path, and format", () => {
    const cases = buildCaseSummaries(files)
    expect(filterCaseSummaries(cases, "tube").map((item) => item.id)).toEqual(["tube-rack"])
    expect(filterCaseSummaries(cases, "seg")[0].artifacts.map((item) => item.kind)).toEqual(["segmentation"])
    expect(filterCaseSummaries(cases, "GLB")[0].artifacts.map((item) => item.kind)).toEqual(["model"])
  })

  test("finds a scan for the launcher's one-click start", () => {
    // A first-run tester should not have to guess which case to open.
    expect(firstScanPath(buildCaseSummaries(files))).toBe("cases/demo-ct/nifti/_545152811.nii.gz")
  })

  test("no scan anywhere means no quick start offered", () => {
    const noScans = buildCaseSummaries(["cases/tube-rack/meshes/tube_rack.stl"])
    expect(firstScanPath(noScans)).toBeUndefined()
    expect(firstScanPath([])).toBeUndefined()
  })

  test("finds a sliced job so the Print View can offer it", () => {
    // The Print View used to say "no sliced job yet" while one sat in the
    // workspace, which reads as a broken panel rather than an empty one.
    const cases = buildCaseSummaries([
      "cases/hand/meshes/finger.stl",
      "cases/hand/prints/finger.gcode.3mf",
    ])
    expect(firstArtifactPath(cases, "print")).toBe("cases/hand/prints/finger.gcode.3mf")
    expect(firstArtifactPath(cases, "model")).toBe("cases/hand/meshes/finger.stl")
    expect(firstArtifactPath(cases, "scan")).toBeUndefined()
  })

  test("never crosses cases — that is how two views showed different parts", () => {
    const cases = buildCaseSummaries([
      "cases/hand/prints/finger.gcode.3mf",
      "cases/knee/meshes/assembly.glb",
    ])
    // Working in knee: no job of its own, so offer none rather than hand's.
    expect(artifactInCase(cases, "knee", "print")).toBeUndefined()
    expect(artifactInCase(cases, "knee", "model")).toBe("cases/knee/meshes/assembly.glb")
    expect(artifactInCase(cases, "hand", "print")).toBe("cases/hand/prints/finger.gcode.3mf")
  })

  test("with no case in context it falls back to the whole workspace", () => {
    const cases = buildCaseSummaries(["cases/hand/prints/finger.gcode.3mf"])
    expect(artifactInCase(cases, undefined, "print")).toBe("cases/hand/prints/finger.gcode.3mf")
  })

  test("reads machine gate verdicts without inferring them", () => {
    expect(parseGateStatus('{"passed":true}')).toBe("passed")
    expect(parseGateStatus('{"passed":false}')).toBe("failed")
    expect(parseGateStatus("not json")).toBeUndefined()
  })
})
