// 3D-Coder vendor code (watcher structure ported from Paperino's core.ts;
// the LaTeX half is replaced by the build123d CAD runner).
import { spawn } from "node:child_process"
import { watch } from "node:fs"
import type { FSWatcher } from "node:fs"
import path from "node:path"
import { createRunQueue } from "./run-queue"

export const BUILD_DIR = ".coder3d"

// Which changes mean "re-run the CAD script" vs "reload the artifact view"?
const SOURCE_RE = /(^|[\\/])cad[\\/][^\\/]+\.(py|params\.json)$/i
const ARTIFACT_RE = /\.(stl|glb|3mf|step|png|json)$/i
const BUILD_DIR_RE = /(^|[\\/])\.coder3d([\\/]|$)/
const RENDER_RE = /(^|[\\/])\.coder3d[\\/]renders[\\/][^\\/]+\.png$/i

export type ChangeKind = "source" | "artifact" | null

export function classifyChange(rel: string): ChangeKind {
  if (BUILD_DIR_RE.test(rel)) {
    // renders inside .coder3d ARE displayable, but must never re-trigger runs
    return RENDER_RE.test(rel) ? "artifact" : null
  }
  if (/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(rel)) return null
  if (SOURCE_RE.test(rel) && !/manifest\.json$/i.test(rel)) return "source"
  if (ARTIFACT_RE.test(rel)) return "artifact"
  return null
}

export type WatchHandlers = {
  // rel paths use forward slashes. onSource fires once per debounce window with
  // the LAST changed source; onArtifact fires per distinct artifact path, so a
  // run that writes stl+glb+step+manifest surfaces each of them.
  onSource: (rel: string) => void
  onArtifact: (rel: string) => void
}

export function watchWorkspace(dir: string, handlers: WatchHandlers, debounceMs = 600): FSWatcher {
  let sourceTimer: ReturnType<typeof setTimeout> | undefined
  let lastSource = ""
  const artifactTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const rel = filename.toString().replaceAll("\\", "/").replace(/^\.\//, "")
    const kind = classifyChange(rel)
    if (!kind) return
    if (kind === "source") {
      lastSource = rel
      clearTimeout(sourceTimer)
      sourceTimer = setTimeout(() => handlers.onSource(lastSource), debounceMs)
    } else {
      clearTimeout(artifactTimers.get(rel))
      artifactTimers.set(
        rel,
        setTimeout(() => {
          artifactTimers.delete(rel)
          handlers.onArtifact(rel)
        }, debounceMs),
      )
    }
  })
  return watcher
}

export type CadRunResult = { ok: boolean; manifestPath: string; message?: string }

/**
 * Run a PARAMS+build() script through the cad-mcp venv. CODER3D_CAD_PYTHON is set
 * by 3dcoder-dev.cmd in dev; a packaged build will point it at the bundled runtime.
 */
export function runCad(
  scriptAbs: string,
  params: Record<string, number> | null,
  opts: { reuse?: boolean } = {},
): Promise<CadRunResult> {
  const python = process.env["CODER3D_CAD_PYTHON"]
  const manifestPath = path.join(path.dirname(scriptAbs), path.basename(scriptAbs, ".py") + ".manifest.json")
  if (!python) {
    return Promise.resolve({
      ok: false,
      manifestPath,
      message: "CODER3D_CAD_PYTHON not set (see 3dcoder-dev.cmd)",
    })
  }
  const args = ["-m", "coder3d_cad.run", "--script", scriptAbs]
  if (params && Object.keys(params).length) args.push("--params-json", JSON.stringify(params))
  // A rebuild triggered by a source edit keeps the values the part was last
  // built with; without this the model silently reverts to script defaults.
  if (opts.reuse) args.push("--reuse")
  return new Promise((resolve) => {
    const child = spawn(python, args, { windowsHide: true, timeout: 300_000 })
    let stderr = ""
    child.stderr.on("data", (d) => (stderr += String(d)))
    child.on("close", (code) =>
      resolve(
        code === 0
          ? { ok: true, manifestPath }
          : { ok: false, manifestPath, message: stderr.slice(-2000) || `exit ${code}` },
      ),
    )
    child.on("error", (e) => resolve({ ok: false, manifestPath, message: String(e) }))
  })
}

type CadRequest = { params: Record<string, number> | null; reuse: boolean }

const cadQueue = createRunQueue<CadRequest, CadRunResult>((scriptAbs, request) =>
  runCad(scriptAbs, request.params, { reuse: request.reuse }),
)

/**
 * The only way the app should build a script. Both writers in this process —
 * the parameter sidebar and the file watcher — go through here, so they can
 * never interleave and leave a mesh that disagrees with its manifest. (The
 * agent's cad_run runs in another process; the runner's lock file covers that.)
 */
export function runCadQueued(
  scriptAbs: string,
  params: Record<string, number> | null,
  opts: { reuse?: boolean } = {},
): Promise<CadRunResult> {
  return cadQueue.submit(path.resolve(scriptAbs), { params, reuse: opts.reuse ?? false })
}
