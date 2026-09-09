// 3D-Coder vendor code (IPC structure ported from Paperino's ipc.ts; the
// compile pipeline is replaced by the CAD runner, detect/onboarding dropped).
import { existsSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { basename, join } from "node:path"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import type { WebContents } from "electron"
import { BAMBU_DOWNLOAD, bambuTargets, findBambuStudio, openInBambuStudio } from "./bambu"
import { CAD_APP_DOWNLOADS, cadAppsAvailable, findCadApp, openDesignIn } from "./cad-apps"
import type { CadApp } from "./cad-apps"
import { claudeChatHistory, claudeChatNewChat, claudeChatSend, claudeChatState, claudeChatStop } from "./claude-chat"
import type { ChatAgent, SendOptions } from "./claude-chat"
import { runCadQueued, watchWorkspace } from "./core"
import { listWorkspaceFiles, readWorkspaceFile, resolveWithin } from "./files"

export type Coder3dStatus = {
  kind: "idle" | "running" | "done" | "error"
  script?: string // case-relative when triggered by the watcher, basename for direct runs
  manifestPath?: string // absolute
  message?: string // error text when kind === "error"
}

type WatchState = { watcher: FSWatcher }

const states = new Map<number, WatchState>()

function stop(id: number) {
  const state = states.get(id)
  if (!state) return
  state.watcher.close()
  states.delete(id)
}

export function registerCoder3dIpc() {
  ipcMain.handle("coder3d-watch", (event, dir: string) => {
    const sender: WebContents = event.sender
    stop(sender.id)

    const sendStatus = (status: Coder3dStatus) => {
      if (!sender.isDestroyed()) sender.send("coder3d-status", status)
    }
    const sendArtifact = (abs: string) => {
      if (!sender.isDestroyed()) sender.send("coder3d-artifact", abs)
    }

    // A project can outlive its folder; an empty panel is the right answer, not a crash.
    if (!existsSync(dir)) {
      sendStatus({ kind: "idle" })
      return
    }

    // Rebuilds go through the shared queue (see core.runCadQueued), which
    // coalesces bursts and keeps this path from racing the sidebar's. `reuse`
    // carries the last built parameter values across a source edit.
    const runScript = async (scriptRel: string) => {
      sendStatus({ kind: "running", script: scriptRel })
      const result = await runCadQueued(join(dir, scriptRel), null, { reuse: true })
      sendStatus(
        result.ok
          ? { kind: "done", script: scriptRel, manifestPath: result.manifestPath }
          : { kind: "error", script: scriptRel, manifestPath: result.manifestPath, message: result.message },
      )
    }

    const watcher = watchWorkspace(dir, {
      // a .params.json edit re-runs its .py; a .py edit re-runs itself
      onSource: (rel) => void runScript(rel.replace(/\.params\.json$/i, ".py")),
      onArtifact: (rel) => sendArtifact(join(dir, rel)),
    })
    states.set(sender.id, { watcher })
    sender.once("destroyed", () => stop(sender.id))
    sendStatus({ kind: "idle" })
  })

  ipcMain.handle("coder3d-unwatch", (event) => stop(event.sender.id))

  ipcMain.handle("coder3d-list-files", (_event, dir: string) => listWorkspaceFiles(dir))

  // Hand a project or a sliced job to Bambu Studio. The path is resolved
  // against the workspace, so the renderer cannot ask for an arbitrary file.
  ipcMain.handle("coder3d-bambu-available", () => findBambuStudio() !== null)
  ipcMain.handle("coder3d-open-in-bambu", (_event, dir: string, relPath: string) => {
    // Not installed: the button is the way to get it, same as the CAD apps.
    if (!findBambuStudio()) {
      void shell.openExternal(BAMBU_DOWNLOAD)
      return { ok: true, launched: "download" as const }
    }
    // A mesh on screen resolves to the .3mf written beside it, which is what
    // a slicer can actually open — the same sibling resolution the CAD apps use.
    const target = bambuTargets(relPath)
      .map((candidate) => resolveWithin(dir, candidate))
      .find((abs) => abs && existsSync(abs))
    if (!target)
      return { ok: false, error: `No .3mf beside ${relPath} — rebuild the part, or slice it first.` }
    const result = openInBambuStudio(target)
    return result.ok ? { ...result, launched: "app" as const } : result
  })

  ipcMain.handle("coder3d-read-file", (_event, dir: string, relPath: string) => readWorkspaceFile(dir, relPath))

  // The folder half of importing a scan. Converting DICOM is the imaging
  // tools' job, but only the OS can answer "which folder?" — so this picks it
  // and the renderer hands the path to the agent.
  ipcMain.handle("coder3d-pick-folder", async (event, title?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ["openDirectory" as const], title: title ?? "Choose a folder" }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? undefined : result.filePaths[0]
  })

  // Design View → real editors: Blender for mesh work, FreeCAD for the B-rep.
  // openDesignIn resolves the best sibling artifact itself (step > stl > 3mf)
  // and refuses anything outside the workspace.
  ipcMain.handle("coder3d-cad-apps-available", () => cadAppsAvailable())
  ipcMain.handle("coder3d-open-in-cad-app", (_event, dir: string, relPath: string, app: CadApp) => {
    if (app !== "blender" && app !== "freecad") return { ok: false, error: "unknown app" }
    // Not installed yet: the same button is the road to installing it. Send
    // the user to the official download page; once it is installed the next
    // click re-probes (misses are never cached) and opens the design.
    if (!findCadApp(app)) {
      void shell.openExternal(CAD_APP_DOWNLOADS[app])
      return { ok: true, launched: "download" as const }
    }
    const result = openDesignIn(app, dir, relPath)
    return result.ok ? { ...result, launched: "app" as const } : result
  })

  // Direct run from the parameter sidebar. Result arrives via coder3d-status;
  // the artifact reloads arrive via the watcher like any other change.
  ipcMain.handle("coder3d-cad-run", async (event, scriptAbs: string, params: Record<string, number>) => {
    const sender = event.sender
    const sendStatus = (status: Coder3dStatus) => {
      if (!sender.isDestroyed()) sender.send("coder3d-status", status)
    }
    sendStatus({ kind: "running", script: basename(scriptAbs) })
    const result = await runCadQueued(scriptAbs, params)
    sendStatus(
      result.ok
        ? { kind: "done", script: basename(scriptAbs), manifestPath: result.manifestPath }
        : { kind: "error", script: basename(scriptAbs), manifestPath: result.manifestPath, message: result.message },
    )
  })

  // Claude chat backend: each turn is a headless `claude -p` run billed to the
  // user's own Claude Code subscription (see claude-chat.ts).
  ipcMain.handle(
    "coder3d-claude-send",
    (event, dir: string, text: string, images?: unknown, options?: SendOptions) =>
      claudeChatSend(event.sender, dir, text, images, options ?? {}),
  )
  ipcMain.handle("coder3d-claude-stop", () => claudeChatStop())
  ipcMain.handle("coder3d-claude-new-chat", (_event, dir: string, agent?: ChatAgent, chatKey?: string) =>
    claudeChatNewChat(dir, agent === "codex" ? "codex" : "claude", chatKey || "default"),
  )
  // The sender re-attaches here, so a window that reloaded mid-turn starts
  // receiving the rest of the stream again.
  ipcMain.handle("coder3d-claude-state", (event, dir: string, agent?: ChatAgent, chatKey?: string) =>
    claudeChatState(dir, event.sender, agent === "codex" ? "codex" : "claude", chatKey || "default"),
  )
  // Replay of Claude Code's own session transcript, so a restarted app shows
  // the conversation it resumed instead of a blank panel.
  ipcMain.handle("coder3d-claude-history", (_event, dir: string, chatKey?: string) =>
    claudeChatHistory(dir, chatKey || "default"),
  )
}
