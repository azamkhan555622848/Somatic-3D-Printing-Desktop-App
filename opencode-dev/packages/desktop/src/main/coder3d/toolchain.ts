/**
 * Somatic's Python tool servers, and how the app installs them for itself.
 *
 * The servers cannot be bundled. Their environments come to 5.4 GB on a
 * developer machine, most of it the imaging stack, and TotalSegmentator then
 * downloads several more gigabytes of model weights on first use. So the
 * installer carries only the Python source (about 1.2 MB) and a copy of `uv`,
 * and the app builds the environments on the machine that will run them. `uv`
 * fetches its own Python, so nothing has to be installed by hand first.
 *
 * Two tiers:
 *
 * - **core** - CAD, mesh, print and the agent bridge. Built on first launch,
 *   because without them the chat can look at a workspace but not act on it.
 * - **on demand** - imaging. It is the expensive one, and a lab member who
 *   only prints parts never needs it, so it is fetched the first time someone
 *   asks for a scan. That is the same bargain the Blender and Bambu Studio
 *   buttons already make: the capability is always visible, and choosing it
 *   is what installs it.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type ToolId = "cad" | "mesh" | "print" | "agent" | "imaging"

export type ToolDef = {
  id: ToolId
  /** Directory under resources/tools holding the Python package. */
  dir: string
  /** Module whose server.py is the entry point. */
  module: string
  label: string
  /** What it is for, in the words used when offering to install it. */
  purpose: string
  /** Rough footprint once built, for honest progress copy. */
  megabytes: number
  /** Milliseconds a call may take before the client gives up. */
  timeout: number
  /**
   * When the environment is built.
   *
   * - `core` blocks first use: the app cannot do its job without it.
   * - `background` is fetched quietly once the core is ready, so the first
   *   launch stays short without the capability being lost.
   * - `on-demand` waits until the operator asks for it, the way the Blender
   *   and Bambu Studio buttons wait to be clicked.
   */
  tier: "core" | "background" | "on-demand"
}

export const TOOLS: ToolDef[] = [
  {
    id: "cad",
    dir: "cad-mcp",
    module: "coder3d_cad",
    label: "CAD",
    purpose: "Builds parts as parametric CAD and exports them.",
    megabytes: 580,
    timeout: 600_000,
    tier: "core",
  },
  {
    id: "mesh",
    dir: "mesh-mcp",
    module: "coder3d_mesh",
    label: "Mesh",
    purpose: "Inspects and repairs geometry, and checks it is watertight.",
    megabytes: 850,
    timeout: 600_000,
    tier: "background",
  },
  {
    id: "print",
    dir: "print-mcp",
    module: "coder3d_print",
    label: "Print",
    purpose: "Slices through Bambu Studio and runs the Print Gate.",
    megabytes: 160,
    // Slicing a large organ runs for minutes.
    timeout: 1_800_000,
    tier: "core",
  },
  {
    id: "agent",
    dir: "claude-mcp",
    module: "coder3d_claude",
    label: "Agent",
    purpose: "Routes design work to the agent.",
    megabytes: 90,
    timeout: 1_800_000,
    tier: "core",
  },
  {
    id: "imaging",
    dir: "medimage-mcp",
    module: "coder3d_medimage",
    label: "Medical imaging",
    purpose: "Reads DICOM and MRI, segments anatomy, and turns it into a mesh.",
    // Torch and the imaging libraries. Segmentation then downloads its model
    // weights separately on first use, which is larger again and is why this
    // tier is not part of the install.
    megabytes: 1500,
    timeout: 1_800_000,
    tier: "on-demand",
  },
]

export const coreTools = () => TOOLS.filter((t) => t.tier === "core")
/** Fetched on their own once the core is ready. */
export const backgroundTools = () => TOOLS.filter((t) => t.tier === "background")
export const onDemandTools = () => TOOLS.filter((t) => t.tier === "on-demand")

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id)
}

/**
 * Bumped when a rebuild is required regardless of what is on disk - a changed
 * dependency, a new Python. The marker lives beside the environment, so an
 * older one is replaced rather than silently reused.
 */
export const TOOLCHAIN_VERSION = 1

export type Platform = "win32" | "darwin" | "linux"

export const envDir = (root: string, tool: ToolDef) => join(root, tool.id)

export function venvPython(root: string, tool: ToolDef, platform: Platform): string {
  return platform === "win32"
    ? join(envDir(root, tool), "Scripts", "python.exe")
    : join(envDir(root, tool), "bin", "python")
}

export const markerFile = (root: string, tool: ToolDef) => join(envDir(root, tool), ".somatic-toolchain")

/** The server script, inside the Python source the installer carries. */
export function serverScript(toolsRoot: string, tool: ToolDef): string {
  return join(toolsRoot, tool.dir, "src", tool.module, "server.py")
}

export const uvBinary = (resourcesRoot: string, platform: Platform) =>
  join(resourcesRoot, "uv", platform === "win32" ? "uv.exe" : "uv")

export type Fs = { exists: (path: string) => boolean; read: (path: string) => string | undefined }

/**
 * Whether an environment is built and current. A marker from an older
 * toolchain counts as absent: the interpreter is there but its packages may
 * not match the source that shipped with this build.
 */
export function isInstalled(root: string, tool: ToolDef, platform: Platform, fs: Fs): boolean {
  if (!fs.exists(venvPython(root, tool, platform))) return false
  const marker = fs.read(markerFile(root, tool))
  if (marker === undefined) return false
  const version = Number(marker.trim())
  return Number.isFinite(version) && version >= TOOLCHAIN_VERSION
}

export function installedTools(root: string, platform: Platform, fs: Fs): ToolId[] {
  return TOOLS.filter((t) => isInstalled(root, t, platform, fs)).map((t) => t.id)
}

/** What still has to be built before the app can do its ordinary work. */
export function missingCore(root: string, platform: Platform, fs: Fs): ToolDef[] {
  return coreTools().filter((t) => !isInstalled(root, t, platform, fs))
}

/** What to fetch quietly afterwards, so the capability arrives without a wait. */
export function missingBackground(root: string, platform: Platform, fs: Fs): ToolDef[] {
  return backgroundTools().filter((t) => !isInstalled(root, t, platform, fs))
}

/** Total download still ahead, for telling the operator what they are in for. */
export function pendingMegabytes(tools: ToolDef[]): number {
  return tools.reduce((sum, t) => sum + t.megabytes, 0)
}

export type McpServer = {
  type: "local"
  command: string[]
  enabled: boolean
  timeout: number
  environment?: Record<string, string>
}

/**
 * The opencode config for the environments that exist. A tool that has not
 * been built is left out entirely rather than declared and broken: a server
 * that fails to spawn reaches the operator as a mysterious error, whereas an
 * absent one lets the app offer to install it.
 */
export function mcpServers(args: {
  envRoot: string
  toolsRoot: string
  platform: Platform
  installed: ToolId[]
  subagentConfig: string
}): Record<string, McpServer> {
  const out: Record<string, McpServer> = {}
  for (const tool of TOOLS) {
    if (!args.installed.includes(tool.id)) continue
    out[`coder3d-${tool.id}`] = {
      type: "local",
      command: [venvPython(args.envRoot, tool, args.platform), serverScript(args.toolsRoot, tool)],
      enabled: true,
      timeout: tool.timeout,
      ...(tool.id === "agent" ? { environment: { CODER3D_SUBAGENT_MCP_CONFIG: args.subagentConfig } } : {}),
    }
  }
  return out
}

/**
 * The servers handed to a headless Claude or Codex turn. The agent bridge is
 * left out on purpose: an agent that can call the tool which spawns an agent
 * recurses.
 */
export function subagentServers(args: {
  envRoot: string
  toolsRoot: string
  platform: Platform
  installed: ToolId[]
}): Record<string, { command: string; args: string[] }> {
  const out: Record<string, { command: string; args: string[] }> = {}
  for (const tool of TOOLS) {
    if (tool.id === "agent" || !args.installed.includes(tool.id)) continue
    out[tool.id] = {
      command: venvPython(args.envRoot, tool, args.platform),
      args: [serverScript(args.toolsRoot, tool)],
    }
  }
  return out
}

/** Arguments for building one environment, in order. `uv` fetches Python itself. */
export function buildSteps(args: { envRoot: string; toolsRoot: string; tool: ToolDef }): {
  label: string
  args: string[]
}[] {
  const dir = envDir(args.envRoot, args.tool)
  const source = join(args.toolsRoot, args.tool.dir)
  return [
    { label: `Preparing Python for ${args.tool.label}`, args: ["venv", "--python", "3.12", dir] },
    { label: `Installing ${args.tool.label}`, args: ["pip", "install", "--python", dir, "--no-cache", source] },
  ]
}

/** A whole-number percentage across a multi-tool install, for the progress bar. */
export function overallProgress(done: number, total: number, stepInTool: number, stepsPerTool: number): number {
  if (total <= 0) return 100
  const perTool = 100 / total
  const within = stepsPerTool > 0 ? (stepInTool / stepsPerTool) * perTool : 0
  return Math.max(0, Math.min(100, Math.round(done * perTool + within)))
}

export const diskFs: Fs = {
  exists: (path) => existsSync(path),
  read: (path) => {
    try {
      // Tiny and synchronous on purpose: this runs once at startup, before
      // there is a window to keep responsive.
      return readFileSync(path, "utf-8")
    } catch {
      return undefined
    }
  },
}

/* -- Building the environments ------------------------------------------- */

export type ToolProgress =
  | { kind: "start"; tool: ToolId; label: string; megabytes: number }
  | { kind: "step"; tool: ToolId; label: string; percent: number }
  | { kind: "log"; tool: ToolId; line: string }
  | { kind: "done"; tool: ToolId }
  | { kind: "error"; tool: ToolId; message: string }

function runUv(uv: string, args: string[], onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(uv, args, { windowsHide: true })
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        const text = line.trim()
        if (text) onLine(text)
      }
    }
    child.stdout.on("data", feed)
    child.stderr.on("data", feed)
    child.on("error", (err) => {
      onLine(String(err))
      resolve(-1)
    })
    child.on("close", (code) => resolve(code ?? -1))
  })
}

/**
 * Build the given environments, in order, reporting as it goes.
 *
 * The marker is written only after the package install returns zero, so an
 * interrupted run leaves the environment looking absent and is retried rather
 * than half-used.
 */
export async function provision(args: {
  tools: ToolDef[]
  envRoot: string
  toolsRoot: string
  uv: string
  onProgress: (event: ToolProgress) => void
}): Promise<{ ok: boolean; installed: ToolId[]; error?: string }> {
  const installed: ToolId[] = []
  mkdirSync(args.envRoot, { recursive: true })

  for (const [index, tool] of args.tools.entries()) {
    args.onProgress({ kind: "start", tool: tool.id, label: tool.label, megabytes: tool.megabytes })
    const steps = buildSteps({ envRoot: args.envRoot, toolsRoot: args.toolsRoot, tool })

    for (const [stepIndex, step] of steps.entries()) {
      args.onProgress({
        kind: "step",
        tool: tool.id,
        label: step.label,
        percent: overallProgress(index, args.tools.length, stepIndex, steps.length),
      })
      const code = await runUv(args.uv, step.args, (line) => args.onProgress({ kind: "log", tool: tool.id, line }))
      if (code !== 0) {
        const message = `${step.label} failed (uv exited ${code})`
        args.onProgress({ kind: "error", tool: tool.id, message })
        return { ok: false, installed, error: message }
      }
    }

    writeFileSync(markerFile(args.envRoot, tool), String(TOOLCHAIN_VERSION), "utf-8")
    installed.push(tool.id)
    args.onProgress({ kind: "done", tool: tool.id })
  }

  args.onProgress({ kind: "step", tool: args.tools.at(-1)?.id ?? "cad", label: "Ready", percent: 100 })
  return { ok: true, installed }
}

/**
 * Write the config the app's own opencode reads. Called after every change to
 * what is installed, so a newly built tool appears without a restart of the
 * machine - though the server list is read when a session starts.
 */
export function writeToolConfig(args: {
  configDir: string
  envRoot: string
  toolsRoot: string
  platform: Platform
  installed: ToolId[]
}): { config: string; subagent: string } {
  const subagent = join(args.configDir, "somatic-subagent-mcp.json")
  const config = join(args.configDir, "opencode.jsonc")
  mkdirSync(dirname(config), { recursive: true })

  writeFileSync(
    config,
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        mcp: mcpServers({ ...args, subagentConfig: subagent }),
        permission: {
          // Machine-owned artifacts: only tool code writes these. findLast
          // wins, so the allow-all has to come first or the denies are dead.
          edit: {
            "*": "allow",
            "*provenance.json": "deny",
            "*meshes/qa*": "deny",
            "*prints/qa*": "deny",
            "*.identity*": "deny",
          },
          bash: {
            "*": "allow",
            "*provenance.json*": "ask",
            "*meshes/qa*": "ask",
            "*prints/qa*": "ask",
            "*.identity*": "ask",
          },
        },
        watcher: { ignore: ["**/.coder3d/**"] },
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  )

  writeFileSync(
    subagent,
    JSON.stringify({ mcpServers: subagentServers(args) }, null, 2) + "\n",
    "utf-8",
  )
  return { config, subagent }
}
