// Open the Design View's model in a real editor — Blender for mesh work,
// FreeCAD for the B-rep. Same shape as bambu.ts: candidate paths, a cached
// find, and a detached GUI launch. Both apps install into versioned folders
// ("Blender 4.5", "FreeCAD 1.0"), so discovery scans the parent directory
// instead of hardcoding a version that goes stale on the next update.
import { execFile } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { resolveWithin } from "./files"

export type CadApp = "blender" | "freecad"

// When the app is not installed, its button opens the official download page
// instead — click, install, click again, and the design opens.
export const CAD_APP_DOWNLOADS: Record<CadApp, string> = {
  blender: "https://www.blender.org/download/",
  freecad: "https://www.freecad.org/downloads.php",
}

type ListDir = (root: string) => string[]

const listDirSafe: ListDir = (root) => {
  try {
    return readdirSync(root)
  } catch {
    return []
  }
}

// Newest version first, so "Blender 4.5" beats "Blender 3.6" (numeric-aware:
// a future "Blender 10" must beat "Blender 9").
function versioned(root: string, prefix: string, relExe: string[], listDir: ListDir): string[] {
  let entries: string[]
  try {
    entries = listDir(root)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((name) => join(root, name, ...relExe))
}

export function blenderCandidates(env: NodeJS.ProcessEnv = process.env, listDir: ListDir = listDirSafe): string[] {
  const override = env["CODER3D_BLENDER"]
  if (override) return [override]
  return [
    ...versioned("C:\\Program Files\\Blender Foundation", "Blender", ["blender.exe"], listDir),
    "/Applications/Blender.app/Contents/MacOS/Blender",
  ]
}

export function freecadCandidates(env: NodeJS.ProcessEnv = process.env, listDir: ListDir = listDirSafe): string[] {
  const override = env["CODER3D_FREECAD"]
  if (override) return [override]
  // FreeCAD 1.0 ships bin/freecad.exe (lowercase); the lookup is on NTFS,
  // where existsSync is case-insensitive, so one spelling covers both eras.
  return [
    ...versioned("C:\\Program Files", "FreeCAD", ["bin", "freecad.exe"], listDir),
    "/Applications/FreeCAD.app/Contents/MacOS/FreeCAD",
  ]
}

// Only positive finds are cached: a miss re-probes every time, so installing
// the app mid-session is seen on the very next click. The scan is a couple of
// readdirs — nothing worth pinning a wrong answer for.
const cached = new Map<CadApp, string>()

export function findCadApp(app: CadApp): string | null {
  const hit = cached.get(app)
  if (hit) return hit
  const candidates = app === "blender" ? blenderCandidates() : freecadCandidates()
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found) cached.set(app, found)
  return found ?? null
}

const stemOf = (rel: string) => rel.replace(/\.[^./\\]+$/, "")

/** Blender is a mesh editor: the glb it can always import, the stl as fallback. */
export function blenderTargets(rel: string): string[] {
  const stem = stemOf(rel)
  return [...new Set([`${stem}.glb`, `${stem}.stl`])]
}

/** FreeCAD wants the real B-rep: cad/<name>.step first, tessellations after. */
export function freecadTargets(rel: string): string[] {
  const stem = stemOf(rel)
  const targets: string[] = []
  const step = stem.replace(/(^|\/)meshes\/([^/]+)$/, "$1cad/$2")
  if (step !== stem) targets.push(`${step}.step`)
  targets.push(`${stem}.stl`, `${stem}.3mf`)
  return targets
}

/** blender <args> imports the model into a fresh scene. The expression stays a
 * single argv line: newlines live as \n escapes inside a python string handed
 * to exec. Forward slashes keep the path free of escaping entirely. */
export function blenderArgs(absPath: string): string[] {
  const p = absPath.replaceAll("\\", "/")
  if (/\.glb$/i.test(p)) return ["--python-expr", `import bpy; bpy.ops.import_scene.gltf(filepath="${p}")`]
  // Blender 4.x removed the stl add-on for the built-in wm.stl_import; older
  // installs only have the add-on. Try new, fall back to old.
  return [
    "--python-expr",
    `exec('import bpy\\ntry:\\n    bpy.ops.wm.stl_import(filepath="${p}")\\nexcept AttributeError:\\n    bpy.ops.import_mesh.stl(filepath="${p}")')`,
  ]
}

export function cadAppsAvailable(): Record<CadApp, boolean> {
  return { blender: findCadApp("blender") !== null, freecad: findCadApp("freecad") !== null }
}

export function openDesignIn(app: CadApp, dir: string, relPath: string): { ok: boolean; error?: string } {
  const binary = findCadApp(app)
  if (!binary) return { ok: false, error: `${app === "blender" ? "Blender" : "FreeCAD"} was not found on this machine.` }
  const targets = app === "blender" ? blenderTargets(relPath) : freecadTargets(relPath)
  // resolveWithin guards every candidate: the renderer can only ever open
  // files that live inside the workspace.
  const target = targets.map((t) => resolveWithin(dir, t)).find((abs) => abs && existsSync(abs))
  if (!target) return { ok: false, error: `No openable file found beside ${relPath}.` }
  const args = app === "blender" ? blenderArgs(target) : [target]
  // Deliberately not awaited: both are long-running GUI apps, so the child
  // only exits when the operator closes it.
  execFile(binary, args, () => {})
  return { ok: true }
}
