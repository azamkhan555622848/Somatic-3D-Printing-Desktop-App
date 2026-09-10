import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Expected paths are built with the same join the code uses. On Linux, where
// CI runs, join uses forward slashes, so a backslash literal never matches and
// an ordering assertion quietly compares -1 with -1.
const blenderExe = (v: string) => join("C:\\Program Files\\Blender Foundation", `Blender ${v}`, "blender.exe")
const freecadExe = (v: string) => join("C:\\Program Files", `FreeCAD ${v}`, "bin", "freecad.exe")
import {
  CAD_APP_DOWNLOADS,
  blenderArgs,
  blenderCandidates,
  blenderTargets,
  findCadApp,
  freecadCandidates,
  freecadTargets,
} from "./cad-apps"

// Both apps install into versioned folders ("Blender 4.5", "FreeCAD 1.0"), so
// discovery scans the parent instead of hardcoding a version that goes stale.
const listDir = (root: string): string[] => {
  if (root === "C:\\Program Files\\Blender Foundation") return ["Blender 3.6", "Blender 4.5"]
  if (root === "C:\\Program Files") return ["FreeCAD 0.21", "FreeCAD 1.0", "Bambu Studio", "Git"]
  return []
}

describe("candidates", () => {
  test("an explicit override wins outright", () => {
    expect(blenderCandidates({ CODER3D_BLENDER: "D:/apps/blender.exe" }, listDir)).toEqual(["D:/apps/blender.exe"])
    expect(freecadCandidates({ CODER3D_FREECAD: "D:/apps/FreeCAD.exe" }, listDir)).toEqual(["D:/apps/FreeCAD.exe"])
  })

  test("versioned install folders are scanned newest-first", () => {
    const blender = blenderCandidates({}, listDir)
    expect(blender.indexOf(blenderExe("4.5"))).toBeGreaterThanOrEqual(0)
    expect(blender.indexOf(blenderExe("4.5"))).toBeLessThan(blender.indexOf(blenderExe("3.6")))
    const freecad = freecadCandidates({}, listDir)
    expect(freecad.indexOf(freecadExe("1.0"))).toBeGreaterThanOrEqual(0)
    expect(freecad.indexOf(freecadExe("1.0"))).toBeLessThan(freecad.indexOf(freecadExe("0.21")))
    expect(freecad.some((c) => c.includes("Bambu") || c.includes("Git"))).toBe(false)
  })

  test("an unreadable root just contributes nothing", () => {
    const boom = () => {
      throw new Error("EACCES")
    }
    expect(blenderCandidates({}, boom).every((c) => typeof c === "string")).toBe(true)
    expect(freecadCandidates({}, boom).some((c) => c.includes("FreeCAD.app"))).toBe(true) // mac path survives
  })
})

describe("findCadApp", () => {
  afterEach(() => {
    delete process.env["CODER3D_BLENDER"]
  })

  test("a miss is never cached - installing mid-session is seen on the next click", () => {
    // The button doubles as an installer bridge: click → download page,
    // install, click again → the app opens. A cached null would break the
    // second click until a restart.
    const tmp = mkdtempSync(join(tmpdir(), "coder3d-blender-"))
    try {
      const stub = join(tmp, "blender.exe")
      process.env["CODER3D_BLENDER"] = stub
      expect(findCadApp("blender")).toBe(null)
      writeFileSync(stub, "")
      expect(findCadApp("blender")).toBe(stub)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("every app has an official download page", () => {
    expect(CAD_APP_DOWNLOADS.blender).toContain("blender.org")
    expect(CAD_APP_DOWNLOADS.freecad).toContain("freecad.org")
  })
})

describe("targets", () => {
  test("Blender gets the glb first, stl as fallback", () => {
    expect(blenderTargets("cases/knee-brace/meshes/cuff.glb")).toEqual([
      "cases/knee-brace/meshes/cuff.glb",
      "cases/knee-brace/meshes/cuff.stl",
    ])
  })

  test("FreeCAD prefers the real B-rep over tessellations", () => {
    // cad/<name>.step is the editable geometry the pipeline exports; the mesh
    // formats are only offered when no STEP exists.
    expect(freecadTargets("cases/knee-brace/meshes/cuff.glb")).toEqual([
      "cases/knee-brace/cad/cuff.step",
      "cases/knee-brace/meshes/cuff.stl",
      "cases/knee-brace/meshes/cuff.3mf",
    ])
  })

  test("a path outside meshes/ offers no step swap", () => {
    expect(freecadTargets("cases/x/exports/thing.stl")).toEqual(["cases/x/exports/thing.stl", "cases/x/exports/thing.3mf"])
  })
})

describe("blenderArgs", () => {
  test("a glb imports through the always-available gltf operator", () => {
    const args = blenderArgs("C:\\ws\\cases\\k\\meshes\\cuff.glb")
    expect(args[0]).toBe("--python-expr")
    expect(args[1]).toContain('bpy.ops.import_scene.gltf(filepath="C:/ws/cases/k/meshes/cuff.glb")')
  })

  test("an stl tries the 4.x operator and falls back to the legacy add-on", () => {
    const args = blenderArgs("C:\\ws\\cuff.stl")
    expect(args[0]).toBe("--python-expr")
    expect(args[1]).toContain("wm.stl_import")
    expect(args[1]).toContain("import_mesh.stl")
    expect(args[1]).toContain('filepath="C:/ws/cuff.stl"')
    // The expression must be a single line: the newlines live as \n escapes
    // inside a python string handed to exec, never as raw argv newlines.
    expect(args[1]).not.toContain("\n")
  })
})
