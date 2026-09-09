// Pure model for the Print View. The renderer never opens a `.gcode.3mf`: a
// plate_N.gcode runs to hundreds of megabytes, so print-mcp writes two small
// sidecars beside the job and this module locates and shapes them.

export type PrintSlot = {
  slot: number
  type: string
  color: string
  used_g: number
  used_m: number
}

export type GateCheck = { passed: boolean; detail?: string }

export type PrintStats = {
  print_time_s?: number
  print_time_human?: string
  weight_g?: number
  support_used?: boolean
  printer_model_id?: string
  printer_settings_id?: string
  slots?: PrintSlot[]
  support_strategy?: string
  material?: string
  intended_use?: string
  use_aux_nozzle?: boolean
  /** Print settings changed away from the template for this job, if any. */
  settings?: Record<string, number | string | boolean>
  gate?: { passed: boolean; checks?: Record<string, GateCheck> }
}

// What each adjustable setting is called on screen. The slicer's own key names
// ("sparse_infill_density") are not what an operator reads a job by.
const SETTING_LABELS: Record<string, string> = {
  infill_density: "infill",
  infill_pattern: "pattern",
  walls: "walls",
  layer_height: "layer",
  supports: "supports",
  top_layers: "top layers",
  bottom_layers: "bottom layers",
}

/** One line naming what was changed, so a surprising weight has a visible cause. */
export function formatSettings(settings: PrintStats["settings"]): string {
  const entries = Object.entries(settings ?? {})
  if (entries.length === 0) return ""
  return entries
    .map(([key, value]) => {
      const label = SETTING_LABELS[key] ?? key
      if (key === "infill_density") return `${label} ${value}%`
      if (key === "layer_height") return `${label} ${value} mm`
      if (typeof value === "boolean") return `${label} ${value ? "on" : "off"}`
      return `${label} ${value}`
    })
    .join(", ")
}

export type PrintPath = { f: number; p: number[][] }
export type PrintLayer = { z: number; paths: PrintPath[] }
export type PrintLayers = {
  layer_height_mm: number
  layers: PrintLayer[]
  truncated: boolean
  features?: string[]
}

// Feature colours, keyed by the names Bambu Studio writes into the gcode.
// Painting every extrusion one colour makes the part an opaque mass — the
// point of a preview is seeing a wall from an infill from a bridge.
export const FEATURE_COLORS: Record<string, string> = {
  "Outer wall": "#F4772B",
  "Inner wall": "#29C25E",
  "Overhang wall": "#2E6BE6",
  "Sparse infill": "#D8B54B",
  "Internal solid infill": "#B85BC9",
  "Top surface": "#E24C4C",
  "Bottom surface": "#4C8FE2",
  "Bridge": "#4FC3D9",
  "Gap infill": "#9AA0A6",
  "Floating vertical shell": "#7FA1C4",
  "Support": "#00A5A5",
  "Support interface": "#66C2C2",
  "Prime tower": "#C08457",
  "Custom": "#8A8F98",
  Unknown: "#7A8290",
}

// Anything the slicer invents that is not in the table still needs a colour.
const FALLBACK_COLORS = ["#C77DFF", "#57C7FF", "#FFD166", "#8AC926", "#FF7B9C", "#B5B5C3"]

export function defaultFeatureColor(name: string, index = 0): string {
  return FEATURE_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/** The legend, in the order the renderer should list it. */
export function featureLegend(
  layers: PrintLayers | undefined,
  overrides: Record<string, string> = {},
): Array<{ name: string; index: number; color: string }> {
  return (layers?.features ?? []).map((name, index) => ({
    name,
    index,
    color: overrides[name] ?? defaultFeatureColor(name, index),
  }))
}

export type ColorMode = "feature" | "single"
export const SINGLE_COLOR = "#5B8FD1"

export function isValidHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

// X2D build volume; dual-nozzle mode loses X to the second toolhead. Mirrors
// PLATE_MM / PLATE_AUX_MM in print-mcp's gate.py.
export const PLATE_MM = { x: 256, y: 256, z: 260 }
export const PLATE_AUX_MM = { x: 235.5, y: 256, z: 256 }

/** `prints/finger.gcode.3mf` -> `prints/finger.stats.json` + `.layers.json`. */
export function sidecarPaths(jobPath: string): { stats: string; layers: string } {
  const normalized = jobPath.replaceAll("\\", "/")
  const slash = normalized.lastIndexOf("/")
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : ""
  // The stem is everything before the FIRST dot of the basename: print-mcp
  // names sidecars off `finger`, not off `finger.gcode`.
  const base = normalized.slice(slash + 1)
  const stem = base.split(".")[0]
  return { stats: `${dir}${stem}.stats.json`, layers: `${dir}${stem}.layers.json` }
}

export function plateFor(stats: PrintStats | undefined) {
  return stats?.use_aux_nozzle ? PLATE_AUX_MM : PLATE_MM
}

export type Badge = { label: string; tone: "pass" | "fail" | "unknown"; detail: string }

/** The gate verdict, phrased for someone deciding whether to print. */
export function gateBadge(stats: PrintStats | undefined): Badge {
  const gate = stats?.gate
  if (!gate) return { label: "No gate verdict", tone: "unknown", detail: "This job was not run through the Print Gate." }
  if (gate.passed) return { label: "Print Gate passed", tone: "pass", detail: "Every check passed." }
  const failed = Object.entries(gate.checks ?? {})
    .filter(([, check]) => !check.passed)
    .map(([name]) => name)
  return {
    label: "Print Gate failed",
    tone: "fail",
    detail: failed.length ? `Failed: ${failed.join(", ")}` : "One or more checks failed.",
  }
}

export function failedChecks(stats: PrintStats | undefined): Array<{ name: string; detail: string }> {
  return Object.entries(stats?.gate?.checks ?? {})
    .filter(([, check]) => !check.passed)
    .map(([name, check]) => ({ name, detail: check.detail ?? "" }))
}

// The check detail says what is WRONG; an operator still needs the next step.
// "reslice with the X2D profile" is not actionable until you know the profile
// comes from a project you export out of Bambu Studio. Keyed by the six check
// names print-mcp/src/coder3d_print/gate.py emits.
export const GATE_REMEDIATION: Record<string, string> = {
  slicer_ok:
    "The file carries no readable slice info. Slice it through the print tools rather than copying a .3mf in by hand.",
  machine:
    "Open Bambu Studio, select this printer and nozzle, load any object, then File → Export → Export project into workspace/print-templates/. Slicing uses that project's settings, so the template is what decides the machine.",
  support_strategy:
    "The strategy you declared and the sliced file disagree. Re-slice with the strategy you actually want, or declare the one the slicer used — support is what the downward-facing anatomy will look like.",
  plate_fit:
    "The part is bigger than the plate as authored, and the slicer will not rotate it for you. Scale it, split it, or re-orient it in the CAD script.",
  material_fit:
    "State what the part is for, and pick a material rated for it. A load-bearing part cannot be signed off on a display filament.",
  stats_attached:
    "The job reports no print time or weight, so it was not really sliced. Re-run the slice and keep the stats sidecar it writes beside the job.",
}

/** What to DO about a failed check, or undefined for a check we have no
 *  guidance for — a wrong guess is worse here than saying nothing. */
export function gateRemediation(check: string): string | undefined {
  return GATE_REMEDIATION[check]
}

/** A tray colour the DOM can use, falling back to a visible grey. */
export function slotSwatch(slot: PrintSlot): string {
  const value = (slot.color ?? "").trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#7a7a80"
}

export function formatGrams(grams: number | undefined): string {
  return typeof grams === "number" && grams > 0 ? `${grams.toFixed(2)} g` : "—"
}

/** Where the slider starts: the top layer, which is what an operator checks. */
export function initialLayerIndex(layers: PrintLayers | undefined): number {
  return layers?.layers?.length ? layers.layers.length - 1 : 0
}

/** A layer range, kept ordered and inside the job — a slab through the part is
 *  the only way to see what is inside an otherwise opaque model. */
export function clampRange(bottom: number, top: number, count: number): [number, number] {
  if (count <= 0) return [0, 0]
  const hi = Math.min(Math.max(Math.round(top), 0), count - 1)
  const lo = Math.min(Math.max(Math.round(bottom), 0), hi)
  return [lo, hi]
}

/** Appearance settings survive restarts: an operator who picked colours for a
 *  review should not have to pick them again for the next job. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A full or blocked localStorage must not take the panel down.
  }
}
