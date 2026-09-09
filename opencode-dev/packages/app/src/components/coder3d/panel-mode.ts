// Mode model for the ChatGPT-style preview panel: a launcher empty state plus
// five full-pane modes.

export type PanelMode = "medical" | "design" | "print" | "files" | "terminal"

export type ModeDef = {
  id: PanelMode
  label: string
  // One line under the label in the launcher. Without it the launcher is five
  // bare rows, and a first-run tester has nothing telling them where to start.
  hint: string
  // Not-ready modes render dimmed in the launcher/strip and cannot be opened.
  ready: boolean
  soon?: string
}

export const MODE_ORDER: readonly PanelMode[] = ["medical", "design", "print", "files", "terminal"]

export const MODES: Record<PanelMode, ModeDef> = {
  medical: { id: "medical", label: "Medical View", hint: "CT and MRI scans, window presets, segmentations", ready: true },
  design: { id: "design", label: "Design View", hint: "The model, with a slider for every parameter", ready: true },
  print: { id: "print", label: "Print View", hint: "Sliced job: toolpaths, time, material, gate verdict", ready: true },
  files: { id: "files", label: "Files", hint: "Every case artifact — scans, meshes, CAD, jobs", ready: true },
  terminal: { id: "terminal", label: "Terminal", hint: "A shell in the workspace folder", ready: true },
}

// Meshes the Design View renders — also the only artifacts that steal navigation.
// STEP stays out: it is CAD interchange for downstream tools, not a viewer target.
export const MESH_NAV_RE = /\.(stl|glb|3mf)$/i

// NIfTI volumes and masks open in the Medical View (NiiVue).
export const NIFTI_NAV_RE = /\.nii(\.gz)?$/i

// A sliced job. It ends in `.3mf` like any project, so this is tested BEFORE
// MESH_NAV_RE or the toolpath, stats and gate verdict would open as a mesh.
export const JOB_NAV_RE = /\.gcode\.3mf$/i

// A click in the Files tree: NIfTI jumps to Medical View, sliced jobs to Print
// View, meshes to Design View, everything else previews in place.
export function modeForFileClick(path: string): "design" | "files" | "medical" | "print" {
  if (NIFTI_NAV_RE.test(path)) return "medical"
  if (JOB_NAV_RE.test(path)) return "print"
  return MESH_NAV_RE.test(path) ? "design" : "files"
}

// Restore a persisted mode; unknown or not-yet-ready values open the launcher.
export function restoreMode(raw: string | null): PanelMode | null {
  if (!raw) return null
  const def = (MODES as Record<string, ModeDef | undefined>)[raw]
  return def?.ready ? def.id : null
}
