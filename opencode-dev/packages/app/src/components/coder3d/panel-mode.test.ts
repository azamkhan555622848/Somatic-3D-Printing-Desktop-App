import { describe, expect, test } from "bun:test"
import { MODES, MODE_ORDER, modeForFileClick, restoreMode, type PanelMode } from "./panel-mode"

describe("MODE_ORDER", () => {
  test("covers every mode exactly once", () => {
    expect([...MODE_ORDER].sort()).toEqual(Object.keys(MODES).sort() as PanelMode[])
  })

  test("every mode explains itself in the launcher", () => {
    // A tester opening the app for the first time gets no other explanation:
    // without these the launcher is five bare rows.
    for (const id of MODE_ORDER) {
      expect(MODES[id].hint.length).toBeGreaterThan(10)
      expect(MODES[id].hint.length).toBeLessThan(70) // one line, not a paragraph
    }
  })

  test("every mode is ready after P3", () => {
    expect(MODES.medical.ready).toBe(true)
    expect(MODES.print.ready).toBe(true)
    expect(MODES.design.ready).toBe(true)
    expect(MODES.files.ready).toBe(true)
    expect(MODES.terminal.ready).toBe(true)
  })
})

describe("modeForFileClick", () => {
  test("meshes jump to Design View", () => {
    expect(modeForFileClick("cases/demo/meshes/tube_rack.stl")).toBe("design")
    expect(modeForFileClick("cases/demo/meshes/TUBE_RACK.GLB")).toBe("design")
    expect(modeForFileClick("cases/demo/print/plate.3mf")).toBe("design")
  })

  test("a sliced job jumps to Print View, not Design View", () => {
    // `.gcode.3mf` also ends in `.3mf`; the sliced job is a toolpath with
    // stats and a gate verdict, and showing it as a bare mesh loses all of it.
    expect(modeForFileClick("cases/demo/prints/finger.gcode.3mf")).toBe("print")
    expect(modeForFileClick("cases/demo/prints/FINGER.GCODE.3MF")).toBe("print")
    expect(modeForFileClick("cases/demo/prints/finger.project.3mf")).toBe("design")
  })

  test("NIfTI volumes jump to Medical View", () => {
    expect(modeForFileClick("cases/demo/nifti/abdomen.nii.gz")).toBe("medical")
    expect(modeForFileClick("cases/demo/segmentations/abdomen/liver.nii.gz")).toBe("medical")
    expect(modeForFileClick("cases/demo/NIFTI/SCAN.NII")).toBe("medical")
  })

  test("documents and sources stay in Files", () => {
    expect(modeForFileClick("cases/demo/cad/tube_rack.py")).toBe("files")
    expect(modeForFileClick("cases/demo/report.pdf")).toBe("files")
    expect(modeForFileClick("cases/demo/.coder3d/renders/iso.png")).toBe("files")
    expect(modeForFileClick("cases/demo/cad/tube_rack.manifest.json")).toBe("files")
    // .step is CAD interchange, not a Design View target — no navigation hijack.
    expect(modeForFileClick("cases/demo/cad/tube_rack.step")).toBe("files")
  })
})

describe("restoreMode", () => {
  test("round-trips ready modes", () => {
    expect(restoreMode("design")).toBe("design")
    expect(restoreMode("files")).toBe("files")
    expect(restoreMode("terminal")).toBe("terminal")
    expect(restoreMode("medical")).toBe("medical")
  })

  test("print round-trips now that P3 landed", () => {
    expect(restoreMode("print")).toBe("print")
  })

  test("unknown values fall back to the launcher", () => {
    expect(restoreMode("garbage")).toBe(null)
    expect(restoreMode(null)).toBe(null)
  })
})
