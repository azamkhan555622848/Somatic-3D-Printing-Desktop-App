// Locate Bambu Studio so the Print View can hand a job straight to it.
// The candidate list mirrors print-mcp/src/coder3d_print/slicer.py — the two
// must agree, or the app offers a button for a slicer the lane cannot drive.
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

export function bambuCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env["CODER3D_BAMBU_STUDIO"]
  if (override) return [override]
  const local = env["LOCALAPPDATA"]
  return [
    "C:\\Program Files\\Bambu Studio\\bambu-studio.exe",
    "C:\\Program Files (x86)\\Bambu Studio\\bambu-studio.exe",
    ...(local ? [join(local, "Programs", "Bambu Studio", "bambu-studio.exe")] : []),
    "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
  ]
}

/** Where to send someone who does not have the slicer yet. The Print View's
 *  button doubles as the route to installing it, the same as Blender's and
 *  FreeCAD's — a hidden button teaches nobody anything. */
export const BAMBU_DOWNLOAD = "https://bambulab.com/en/download/studio"

let cached: string | undefined

export function findBambuStudio(): string | null {
  if (cached) return cached
  const found = bambuCandidates().find((candidate) => existsSync(candidate))
  // Only a hit is remembered: installing the slicer while Somatic is open
  // should not need a restart to be noticed.
  if (found) cached = found
  return found ?? null
}

/** What the slicer should open for the artifact on screen. A sliced job opens
 *  itself; a mesh opens the .3mf the CAD runner now writes beside it, which is
 *  the file you would actually load into Bambu Studio. Mirrors the sibling
 *  resolution the Blender and FreeCAD buttons use. */
export function bambuTargets(rel: string): string[] {
  if (/\.3mf$/i.test(rel) || /\.gcode$/i.test(rel)) return [rel]
  const stem = rel.replace(/\.[^./\\]+$/, "")
  // The 3mf first, because it carries the print profile. But only the CAD
  // runner writes one: a mesh that came from segmentation or repair has just
  // a glb and an stl beside it, and demanding the 3mf left this button doing
  // nothing at all on an anatomy mesh. Bambu Studio imports stl natively, so
  // it is the fallback - the same shape as the Blender and FreeCAD lists.
  return [...new Set([`${stem}.3mf`, `${stem}.stl`])]
}

export function openInBambuStudio(filePath: string): { ok: boolean; error?: string } {
  const binary = findBambuStudio()
  if (!binary) return { ok: false, error: "Bambu Studio was not found on this machine." }
  if (!existsSync(filePath)) return { ok: false, error: `${filePath} no longer exists.` }
  // Deliberately not awaited: Bambu Studio is a long-running GUI app, so the
  // child only exits when the operator closes it.
  execFile(binary, [filePath], () => {})
  return { ok: true }
}
