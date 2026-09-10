import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  TOOLCHAIN_VERSION,
  TOOLS,
  buildSteps,
  coreTools,
  backgroundTools,
  installedTools,
  isInstalled,
  markerFile,
  mcpServers,
  missingBackground,
  missingCore,
  onDemandTools,
  pendingMegabytes,
  overallProgress,
  serverScript,
  subagentServers,
  toolById,
  uvBinary,
  venvPython,
  type Fs,
  type ToolId,
} from "./toolchain"

const ENV = "/data/tool-envs"
const SRC = "/app/resources/tools"
const tool = (id: string) => TOOLS.find((t) => t.id === id)!

/** A fake disk: every listed path exists, and markers hold the given version. */
const fakeFs = (present: string[], markers: Record<string, string> = {}): Fs => ({
  exists: (p) => present.includes(p),
  read: (p) => markers[p],
})

const built = (ids: string[], version = String(TOOLCHAIN_VERSION)) => {
  const present: string[] = []
  const markers: Record<string, string> = {}
  for (const id of ids) {
    present.push(venvPython(ENV, tool(id), "linux"))
    markers[markerFile(ENV, tool(id))] = version
  }
  return fakeFs(present, markers)
}

describe("the three tiers", () => {
  test("only what the app cannot work without blocks the first launch", () => {
    expect(coreTools().map((t) => t.id)).toEqual(["cad", "print", "agent"])
  })

  test("mesh follows on its own, so the capability is deferred and not lost", () => {
    // Mesh repair only matters once there is geometry to repair, so it is
    // fetched quietly after the core rather than held against first use.
    expect(backgroundTools().map((t) => t.id)).toEqual(["mesh"])
  })

  test("imaging waits to be asked for, like Blender and Bambu Studio", () => {
    expect(onDemandTools().map((t) => t.id)).toEqual(["imaging"])
  })

  test("every tool belongs to exactly one tier", () => {
    const tiers = [...coreTools(), ...backgroundTools(), ...onDemandTools()].map((t) => t.id)
    expect(tiers.sort()).toEqual(TOOLS.map((t) => t.id).sort())
    expect(new Set(tiers).size).toBe(TOOLS.length)
  })

  test("the first launch stays under a gigabyte", () => {
    // The whole point of the split: a lab member waits once, briefly.
    expect(pendingMegabytes(coreTools())).toBeLessThan(1000)
    expect(pendingMegabytes(TOOLS)).toBeGreaterThan(2000)
  })

  test("nothing in the core tier is anywhere near the size of imaging", () => {
    const heaviestCore = Math.max(...coreTools().map((t) => t.megabytes))
    expect(heaviestCore).toBeLessThan(tool("imaging").megabytes)
  })

  test("every tool says what it is for, so the offer to install can be honest", () => {
    for (const t of TOOLS) {
      expect(t.purpose.trim().endsWith(".")).toBe(true)
      expect(t.megabytes).toBeGreaterThan(0)
      expect(t.timeout).toBeGreaterThan(0)
    }
    expect(toolById("imaging")?.label).toBe("Medical imaging")
    expect(toolById("nope")).toBeUndefined()
  })
})

describe("locating things", () => {
  test("the interpreter sits where each platform puts it", () => {
    expect(venvPython(ENV, tool("cad"), "win32")).toBe(join(ENV, "cad", "Scripts", "python.exe"))
    expect(venvPython(ENV, tool("cad"), "darwin")).toBe(join(ENV, "cad", "bin", "python"))
  })

  test("the server script is found in the source the installer carries", () => {
    expect(serverScript(SRC, tool("print"))).toBe(join(SRC, "print-mcp", "src", "coder3d_print", "server.py"))
  })

  test("uv is an exe only on Windows", () => {
    expect(uvBinary("/res", "win32")).toBe(join("/res", "uv", "uv.exe"))
    expect(uvBinary("/res", "linux")).toBe(join("/res", "uv", "uv"))
  })
})

describe("what counts as installed", () => {
  test("an interpreter with a current marker", () => {
    expect(isInstalled(ENV, tool("cad"), "linux", built(["cad"]))).toBe(true)
  })

  test("an interpreter with no marker does not count", () => {
    // A half-finished build leaves the interpreter behind. Treating that as
    // installed would wire up a server whose packages were never installed.
    const fs = fakeFs([venvPython(ENV, tool("cad"), "linux")])
    expect(isInstalled(ENV, tool("cad"), "linux", fs)).toBe(false)
  })

  test("a marker from an older toolchain means rebuild", () => {
    const stale = built(["cad"], String(TOOLCHAIN_VERSION - 1))
    expect(isInstalled(ENV, tool("cad"), "linux", stale)).toBe(false)
  })

  test("a marker that is not a number is not trusted", () => {
    const junk = built(["cad"], "whatever")
    expect(isInstalled(ENV, tool("cad"), "linux", junk)).toBe(false)
  })

  test("a fresh machine needs the core, and mesh follows separately", () => {
    const empty = fakeFs([])
    expect(missingCore(ENV, "linux", empty).map((t) => t.id)).toEqual(["cad", "print", "agent"])
    expect(missingBackground(ENV, "linux", empty).map((t) => t.id)).toEqual(["mesh"])
    expect(installedTools(ENV, "linux", empty)).toEqual([])
  })

  test("with the core built, nothing more is required to start", () => {
    const fs = built(["cad", "print", "agent"])
    expect(missingCore(ENV, "linux", fs)).toEqual([])
    // Mesh is still outstanding, but it is not what start-up waits on.
    expect(missingBackground(ENV, "linux", fs).map((t) => t.id)).toEqual(["mesh"])
    expect(installedTools(ENV, "linux", fs)).toEqual(["cad", "print", "agent"])
  })

  test("once mesh arrives there is nothing left but imaging", () => {
    const fs = built(["cad", "mesh", "print", "agent"])
    expect(missingBackground(ENV, "linux", fs)).toEqual([])
    expect(installedTools(ENV, "linux", fs)).toEqual(["cad", "mesh", "print", "agent"])
  })
})

describe("the generated config", () => {
  const config = (ids: ToolId[]) =>
    mcpServers({ envRoot: ENV, toolsRoot: SRC, platform: "linux", installed: ids, subagentConfig: "/cfg/sub.json" })

  test("only built tools are declared", () => {
    // A declared-but-absent server fails to spawn and reaches the operator as
    // a mysterious error; leaving it out lets the app offer to install it.
    const servers = config(["cad", "mesh", "print", "agent"])
    expect(Object.keys(servers)).toEqual(["coder3d-cad", "coder3d-mesh", "coder3d-print", "coder3d-agent"])
    // Before mesh finishes downloading it simply is not there.
    expect(Object.keys(config(["cad", "print", "agent"]))).not.toContain("coder3d-mesh")
    expect(Object.keys(config([]))).toEqual([])
  })

  test("imaging joins the config once it is installed", () => {
    const servers = config(["cad", "imaging"])
    expect(Object.keys(servers)).toContain("coder3d-imaging")
    expect(servers["coder3d-imaging"]!.command[1]).toContain("coder3d_medimage")
  })

  test("each server runs its own interpreter against its own script", () => {
    const cad = config(["cad"])["coder3d-cad"]!
    expect(cad.command).toEqual([venvPython(ENV, tool("cad"), "linux"), serverScript(SRC, tool("cad"))])
    expect(cad.enabled).toBe(true)
    expect(cad.timeout).toBe(tool("cad").timeout)
  })

  test("only the agent bridge is told where the subagent config lives", () => {
    const servers = config(["cad", "agent"])
    expect(servers["coder3d-agent"]!.environment).toEqual({ CODER3D_SUBAGENT_MCP_CONFIG: "/cfg/sub.json" })
    expect(servers["coder3d-cad"]!.environment).toBeUndefined()
  })

  test("the subagent never gets the tool that spawns an agent", () => {
    // Otherwise a delegated turn can delegate again, forever.
    const sub = subagentServers({
      envRoot: ENV,
      toolsRoot: SRC,
      platform: "linux",
      installed: ["cad", "agent", "imaging"],
    })
    expect(Object.keys(sub).sort()).toEqual(["cad", "imaging"])
  })
})

describe("building an environment", () => {
  test("creates the interpreter, then installs the package into it", () => {
    const steps = buildSteps({ envRoot: ENV, toolsRoot: SRC, tool: tool("mesh") })
    expect(steps).toHaveLength(2)
    expect(steps[0]!.args).toEqual(["venv", "--python", "3.12", join(ENV, "mesh")])
    expect(steps[1]!.args).toContain(join(SRC, "mesh-mcp"))
    expect(steps[1]!.args).toContain("--python")
    for (const step of steps) expect(step.label).toContain("Mesh")
  })

  test("progress runs from nothing to complete without overshooting", () => {
    expect(overallProgress(0, 4, 0, 2)).toBe(0)
    expect(overallProgress(2, 4, 0, 2)).toBe(50)
    expect(overallProgress(2, 4, 1, 2)).toBe(63)
    expect(overallProgress(4, 4, 0, 2)).toBe(100)
    expect(overallProgress(9, 4, 9, 2)).toBe(100)
    expect(overallProgress(0, 0, 0, 0)).toBe(100)
  })
})
