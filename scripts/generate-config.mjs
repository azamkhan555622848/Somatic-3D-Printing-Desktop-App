#!/usr/bin/env node
/**
 * Generate Somatic's opencode config for THIS machine.
 *
 * The MCP servers are launched by absolute path, so the config cannot be a
 * tracked file with someone else's home directory baked into it. It is built
 * here from the repository root instead, and the generated files are ignored
 * by git. Run this after `setup.ps1` / `setup.sh`, or any time the repo moves.
 *
 * Node only — no dependencies — because it runs before any virtualenv exists.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
// opencode reads JSON with forward slashes on every platform.
const p = (...parts) => join(root, ...parts).replaceAll("\\", "/")

const isWindows = process.platform === "win32"
const venvPython = (pkg) => p(pkg, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python")

/** The five tool servers Somatic ships. Everything else a developer may have
 *  in their own opencode config is disabled below. */
const SERVERS = [
  { key: "cad", pkg: "cad-mcp", module: "coder3d_cad", timeout: 600_000 },
  { key: "mesh", pkg: "mesh-mcp", module: "coder3d_mesh", timeout: 600_000 },
  // Segmentation downloads weights on first run and can take minutes.
  { key: "medimage", pkg: "medimage-mcp", module: "coder3d_medimage", timeout: 1_800_000 },
  // Drives the Bambu Studio CLI; slicing a large organ runs for minutes.
  { key: "print", pkg: "print-mcp", module: "coder3d_print", timeout: 1_800_000 },
  { key: "claude", pkg: "claude-mcp", module: "coder3d_claude", timeout: 1_800_000 },
]

const serverPaths = (s) => [venvPython(s.pkg), p(s.pkg, "src", s.module, "server.py")]

const configDir = p("opencode-dev", "3dcoder-config")
const subagentConfig = join(configDir, "claude-subagent-mcp.json").replaceAll("\\", "/")

// --- opencode.jsonc --------------------------------------------------------
const mcp = {}
for (const s of SERVERS) {
  mcp[`coder3d-${s.key}`] = {
    type: "local",
    command: serverPaths(s),
    enabled: true,
    timeout: s.timeout,
    ...(s.key === "claude"
      ? { environment: { CODER3D_SUBAGENT_MCP_CONFIG: subagentConfig } }
      : {}),
  }
}
// Servers a developer may have in their own global opencode config. A packaged
// build never sees these (main/index.ts isolates XDG_CONFIG_HOME), but a dev
// run merges them, and Somatic should not silently inherit unrelated tools.
for (const foreign of [
  "blender", "freecad", "kicad", "partfetch", "platformio",
  "playwright", "mongodb", "thingsboard", "embedded-debugger", "stitch",
]) {
  mcp[foreign] = { enabled: false }
}

const opencodeConfig = {
  $schema: "https://opencode.ai/config.json",
  mcp,
  permission: {
    // Skills leaked in from a developer's own global opencode config. Somatic
    // is a medical printing workspace; PCB and firmware skills only add noise.
    skill: {
      "*": "allow",
      "pcb-*": "deny",
      "schematic-*": "deny",
      "arduino-*": "deny",
      "esp32-*": "deny",
      "stm32-*": "deny",
      "zephyr-*": "deny",
      "*-for-iot": "deny",
      "bun-file-io": "deny",
      "flutter-expert": "deny",
      "mobile-developer": "deny",
    },
    // Machine-owned artifacts: only tool code writes these (spec 5.2).
    // findLast wins, so the allow-all must come first or the denies are dead.
    edit: {
      "*": "allow",
      "*provenance.json": "deny",
      "*meshes/qa*": "deny",
      "*prints/qa*": "deny",
      "*.identity*": "deny",
    },
    // A shell redirect would bypass the edit tool; ask makes it visible.
    bash: {
      "*": "allow",
      "*provenance.json*": "ask",
      "*meshes/qa*": "ask",
      "*prints/qa*": "ask",
      "*.identity*": "ask",
    },
  },
  watcher: { ignore: ["**/.coder3d/**"] },
}

// --- claude-subagent-mcp.json ---------------------------------------------
// The headless Claude/Codex turn gets the geometry and imaging tools, not the
// delegate itself: an agent that can spawn another agent recurses.
const mcpServers = {}
for (const s of SERVERS) {
  if (s.key === "claude") continue
  const [command, script] = serverPaths(s)
  mcpServers[s.key] = { command, args: [script] }
}

mkdirSync(configDir, { recursive: true })
writeFileSync(join(configDir, "opencode.jsonc"), JSON.stringify(opencodeConfig, null, 2) + "\n", "utf-8")
writeFileSync(subagentConfig, JSON.stringify({ mcpServers }, null, 2) + "\n", "utf-8")

console.log(`Somatic config written for ${root}`)
console.log(`  ${join(configDir, "opencode.jsonc")}`)
console.log(`  ${subagentConfig}`)
for (const s of SERVERS) console.log(`  server coder3d-${s.key} -> ${venvPython(s.pkg)}`)
