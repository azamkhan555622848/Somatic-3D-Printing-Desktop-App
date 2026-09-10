// 3D-Coder vendor code — the always-on preview panel, organized like the
// ChatGPT desktop side panel: an empty-state launcher plus full-pane modes
// (Medical/Design/Print/Files/Terminal).
import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useCommand } from "@/context/command"
import { useSDK } from "@/context/sdk"
import { TerminalPanelV2 } from "@/pages/session/terminal-panel-v2"
import {
  artifactInCase,
  buildCaseSummaries,
  caseIDForPath,
  firstScanPath,
  parseGateStatus,
  type GateStatus,
} from "./case-browser"
import { CaseNavigator, CaseOverview } from "./case-navigator"
import { prefillComposer } from "./claude-chat/claude-chat"
import { FilePreview, type FilePreviewState } from "./file-preview"
import { Coder3dLauncher, modeIcon } from "./launcher"
import { ToolOffer, hasTool } from "./tool-setup"
import { MedicalView } from "./medical-view"
import { BambuStudioIcon, BlenderIcon, CollapseDiagonalIcon, ExpandDiagonalIcon, FreeCADIcon } from "./panel-icons"
import {
  JOB_NAV_RE,
  MESH_NAV_RE,
  MODES,
  MODE_ORDER,
  NIFTI_NAV_RE,
  modeForFileClick,
  restoreMode,
  type PanelMode,
} from "./panel-mode"
import { ParamSidebar, type Manifest } from "./param-sidebar"
import { PrintView } from "./print-view"

type Coder3dStatus = {
  kind: "idle" | "running" | "done" | "error"
  script?: string
  manifestPath?: string
  message?: string
}
type ReadFileError = "invalid-path" | "not-found" | "too-large"
type Coder3dBridge = {
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  onStatus: (cb: (status: Coder3dStatus) => void) => () => void
  onArtifact: (cb: (absPath: string) => void) => () => void
  listFiles: (dir: string) => Promise<{ files: string[]; truncated: boolean }>
  readFile: (
    dir: string,
    relPath: string,
  ) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: ReadFileError }>
  cadRun: (scriptAbs: string, params: Record<string, number>) => Promise<void>
  // Optional: a renderer hot-reloaded onto an older preload has no picker.
  pickFolder?: (title?: string) => Promise<string | undefined>
  bambuAvailable?: () => Promise<boolean>
  openInBambu: (
    dir: string,
    relPath: string,
  ) => Promise<{ ok: boolean; launched?: "app" | "download"; error?: string }>
  cadAppsAvailable?: () => Promise<{ blender: boolean; freecad: boolean }>
  openInCadApp?: (
    dir: string,
    relPath: string,
    app: "blender" | "freecad",
  ) => Promise<{ ok: boolean; launched?: "app" | "download"; error?: string }>
}

const bridge = (): Coder3dBridge | undefined => (window as { api?: { coder3d?: Coder3dBridge } }).api?.coder3d

const WIDTH_KEY = "coder3d-panel-width"
const TREE_WIDTH_KEY = "coder3d-tree-width"
const OPEN_KEY = "coder3d-panel-open"
const EXPANDED_KEY = "coder3d-panel-expanded"
const MODE_KEY = "coder3d-panel-mode"

// The session layout's terminal state: Ctrl+` and the header terminal button
// keep working — they now open the panel's Terminal mode instead of a rail.
type TerminalBridge = { opened: () => boolean; toggle: () => void }

export function Coder3dPreviewPanel(props: { terminal?: TerminalBridge }) {
  const sdk = useSDK()
  const command = useCommand()
  const api = bridge()

  const [status, setStatus] = createSignal<Coder3dStatus>({ kind: "idle" })
  const [width, setWidth] = createSignal(Number(localStorage.getItem(WIDTH_KEY)) || 480)

  const [open, setOpen] = createSignal(localStorage.getItem(OPEN_KEY) !== "0")
  const [expanded, setExpanded] = createSignal(localStorage.getItem(EXPANDED_KEY) === "1")
  const [mode, setModeRaw] = createSignal<PanelMode | null>(restoreMode(localStorage.getItem(MODE_KEY)))

  const [treeWidth, setTreeWidth] = createSignal(Number(localStorage.getItem(TREE_WIDTH_KEY)) || 320)
  const [listing, setListing] = createSignal<{ files: string[]; truncated: boolean }>({ files: [], truncated: false })
  const [gateStatuses, setGateStatuses] = createSignal<Record<string, GateStatus>>({})
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [selectedCaseID, setSelectedCaseID] = createSignal<string>()
  const cases = createMemo(() => buildCaseSummaries(listing().files))
  const selectedCase = createMemo(
    () => cases().find((summary) => summary.id === selectedCaseID()) ?? cases()[0],
  )

  // Design View state: the current mesh and its parameter manifest.
  const [meshPath, setMeshPath] = createSignal<string>()
  const [meshState, setMeshState] = createSignal<FilePreviewState>()
  const [manifest, setManifest] = createSignal<Manifest>()
  // Files mode state: whatever document is previewed next to the tree.
  const [docPath, setDocPath] = createSignal<string>()
  const [docState, setDocState] = createSignal<FilePreviewState>()
  // Medical View state: the NIfTI volume on screen (overlays load beside it).
  const [medPath, setMedPath] = createSignal<string>()
  // Print View state: the sliced job on screen (its sidecars load beside it).
  const [jobPath, setJobPath] = createSignal<string>()

  const persistOpen = (next: boolean) => {
    setOpen(next)
    localStorage.setItem(OPEN_KEY, next ? "1" : "0")
  }

  const persistExpanded = (next: boolean) => {
    setExpanded(next)
    localStorage.setItem(EXPANDED_KEY, next ? "1" : "0")
  }

  // Leaving Terminal mode keeps the app-level terminal state honest, so the
  // header button and Ctrl+` stay in sync with what the pane shows.
  const setMode = (next: PanelMode | null) => {
    if (mode() === "terminal" && next !== "terminal" && props.terminal?.opened()) props.terminal.toggle()
    setModeRaw(next)
    if (next) localStorage.setItem(MODE_KEY, next)
    else localStorage.removeItem(MODE_KEY)
  }

  const selectMode = (next: PanelMode) => {
    if (!MODES[next].ready) return
    if (next === "files") void refreshListing()
    if (next === "terminal" && props.terminal && !props.terminal.opened()) props.terminal.toggle()
    setMode(next)
  }

  // One-click start for a first-run tester: the first scan in the workspace,
  // opened in the Medical View. Absent when there is no scan to open, so the
  // launcher never offers a button that would land on an empty panel.
  // Import: the OS answers "which folder", the agent does the conversion
  // (dcm2niix through the imaging tools). The button fills the composer rather
  // than sending, so the operator reads the request before it runs.
  const [importHint, setImportHint] = createSignal<string>()
  const importDicomFolder = async () => {
    const workspace = sdk().directory
    if (!api?.pickFolder || !workspace) return
    const folder = await api.pickFolder("Choose the DICOM folder to import")
    if (!folder) return
    prefillComposer(
      workspace,
      `Import the DICOM folder at ${folder} into a new case: convert it to NIfTI, then open the volume in the Medical View.`,
    )
    setImportHint("Sent to the chat box — press Enter there to run the import.")
  }

  const quickStart = createMemo(() => firstScanPath(cases()))
  // The case being worked in: whatever is already open in any view, else the
  // one last picked in Files. Every view answers to this, so Design and Print
  // cannot end up showing parts from two different patients at once.
  const activeCaseID = createMemo(
    () =>
      caseIDForPath(meshPath() ?? "") ??
      caseIDForPath(jobPath() ?? "") ??
      caseIDForPath(medPath() ?? "") ??
      selectedCaseID(),
  )
  const activeCaseName = createMemo(() => cases().find((c) => c.id === activeCaseID())?.name)
  // Empty states offer what this case already holds. Saying "no sliced job yet"
  // while one sits in its prints/ reads as a broken panel, not an empty one —
  // but offering another case's job is worse than offering nothing.
  const caseJob = createMemo(() => artifactInCase(cases(), activeCaseID(), "print"))
  const caseModel = createMemo(() => artifactInCase(cases(), activeCaseID(), "model"))
  const openQuickStart = () => {
    const path = quickStart()
    if (!path) return
    setMedPath(path)
    setMode("medical")
  }

  // Closing drops the expanded state too: reopening from the rail should give back
  // the split view, not silently swallow the whole window. It also returns to the
  // launcher — reopening is a fresh choice, like ChatGPT's panel.
  const closePanel = () => {
    setMode(null)
    persistExpanded(false)
    persistOpen(false)
  }

  let meshToken = 0
  let docToken = 0
  let listingToken = 0

  const refreshListing = async () => {
    const dir = sdk().directory
    if (!api || !dir) return
    const token = ++listingToken
    const next = await api.listFiles(dir)
    if (token !== listingToken) return
    setListing(next)

    const verdicts = await Promise.all(
      next.files
        .filter((path) => /\/meshes\/qa\/[^/]+\.gate\.json$/i.test(path))
        .slice(0, 100)
        .map(async (path) => {
          const result = await api.readFile(dir, path)
          if (!result.ok) return
          const verdict = parseGateStatus(new TextDecoder().decode(result.bytes))
          return verdict ? ([path, verdict] as const) : undefined
        }),
    )
    if (token !== listingToken) return
    setGateStatuses(Object.fromEntries(verdicts.filter((item): item is readonly [string, GateStatus] => !!item)))
  }

  const openMesh = async (path: string) => {
    const dir = sdk().directory
    if (!api || !dir) return
    const token = ++meshToken
    const pathChanged = meshPath() !== path
    setMeshPath(path)
    setMeshState({ path })
    if (pathChanged) void refreshManifest()
    const result = await api.readFile(dir, path)
    if (token !== meshToken) return
    setMeshState(result.ok ? { path, bytes: result.bytes } : { path, error: result.error })
  }

  // A read can land while a build is still writing the mesh; the viewer reports
  // the truncated buffer instead of throwing, and we re-read a few times.
  const meshRetries = new Map<string, number>()
  const retryMesh = (path: string) => {
    const attempts = meshRetries.get(path) ?? 0
    if (attempts >= 4) return
    meshRetries.set(path, attempts + 1)
    setTimeout(() => {
      if (meshPath() === path) void openMesh(path)
    }, 400 * (attempts + 1))
  }

  const openDoc = async (path: string) => {
    const dir = sdk().directory
    if (!api || !dir) return
    const token = ++docToken
    setDocPath(path)
    setDocState({ path })
    const result = await api.readFile(dir, path)
    if (token !== docToken) return
    setDocState(result.ok ? { path, bytes: result.bytes } : { path, error: result.error })
  }

  // NIfTI jumps to Medical View, meshes to Design View; everything else
  // previews beside the tree.
  // Opening something from one case must not leave another case's part loaded
  // in a different view. Two panes showing two patients at once is how a wrong
  // part gets printed, so the stale one is dropped rather than left behind.
  const dropOtherCases = (caseID: string | undefined) => {
    if (!caseID) return
    const foreign = (path: string | undefined) => !!path && caseIDForPath(path) !== caseID
    if (foreign(meshPath())) {
      setMeshPath(undefined)
      setMeshState(undefined)
      setManifest(undefined)
    }
    if (foreign(jobPath())) setJobPath(undefined)
    if (foreign(medPath())) setMedPath(undefined)
    if (foreign(docPath())) {
      setDocPath(undefined)
      setDocState(undefined)
    }
  }

  const openFromTree = (path: string) => {
    setSelectedPath(path)
    const caseID = caseIDForPath(path)
    if (caseID) setSelectedCaseID(caseID)
    dropOtherCases(caseID)
    const target = modeForFileClick(path)
    if (target === "medical") {
      setMode("medical")
      setMedPath(path)
    } else if (target === "print") {
      setMode("print")
      setJobPath(path)
    } else if (target === "design") {
      setMode("design")
      void openMesh(path)
    } else {
      void openDoc(path)
    }
  }

  const clearContent = () => {
    listingToken++
    meshToken++
    docToken++
    setSelectedPath(undefined)
    setSelectedCaseID(undefined)
    setGateStatuses({})
    setMeshPath(undefined)
    setMeshState(undefined)
    setManifest(undefined)
    setDocPath(undefined)
    setDocState(undefined)
    setMedPath(undefined)
  }

  // cases/<case>/meshes/<name>.stl|glb -> cases/<case>/cad/<name>.manifest.json
  const manifestRelFor = (path: string) => {
    const m = path.match(/^(.*)\/meshes\/([^/]+)\.(stl|glb)$/i)
    return m ? `${m[1]}/cad/${m[2]}.manifest.json` : undefined
  }

  const refreshManifest = async () => {
    const dir = sdk().directory
    const path = meshPath()
    const rel = path ? manifestRelFor(path) : undefined
    if (!api || !dir || !rel) {
      setManifest(undefined)
      return
    }
    const result = await api.readFile(dir, rel)
    if (!result.ok) {
      setManifest(undefined)
      return
    }
    try {
      setManifest(JSON.parse(new TextDecoder().decode(result.bytes)) as Manifest)
    } catch {
      setManifest(undefined)
    }
  }

  // The sidebar re-runs the script through the main process; results come back
  // via coder3d-status, and the watcher reloads the mesh like any other change.
  const runWithParams = (params: Record<string, number>) => {
    const dir = sdk().directory
    const path = meshPath()
    const m = manifest()
    if (!api || !dir || !path || !m) return
    const caseRel = path.replace(/\/meshes\/[^/]+$/i, "")
    const scriptAbs = `${dir.replaceAll("\\", "/")}/${caseRel}/${m.script}`
    void api.cadRun(scriptAbs, params)
  }

  const toRel = (abs: string) => {
    const dir = sdk().directory
    if (!dir) return undefined
    const normAbs = abs.replaceAll("\\", "/")
    const normDir = dir.replaceAll("\\", "/").replace(/\/+$/, "")
    return normAbs.startsWith(normDir + "/") ? normAbs.slice(normDir.length + 1) : undefined
  }

  // Ctrl+` / the header terminal button drive the session's terminal state;
  // mirror it into the panel. defer skips the initial run so a restored
  // non-terminal mode isn't clobbered on mount.
  createEffect(
    on(
      () => props.terminal?.opened() ?? false,
      (opened) => {
        if (opened) {
          persistOpen(true)
          if (mode() !== "terminal") {
            setModeRaw("terminal")
            localStorage.setItem(MODE_KEY, "terminal")
          }
        } else if (mode() === "terminal") {
          setMode(null)
        }
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const dir = sdk().directory
    if (!api || !dir) return

    // Switching projects must not leave the previous case on screen
    clearContent()
    setStatus({ kind: "idle" })
    setListing({ files: [], truncated: false })
    // Always, not just in Files mode: the launcher's quick-start row needs to
    // know whether the workspace has a scan before anyone opens anything.
    void refreshListing()

    const unsubStatus = api.onStatus((next) => {
      setStatus(next)
      // A finished run rewrote the manifest values — pick them up.
      if (next.kind === "done" || next.kind === "error") void refreshManifest()
    })
    const unsubArtifact = api.onArtifact((abs) => {
      const rel = toRel(abs)
      if (!rel) return
      if (mode() === "files") void refreshListing()
      // A finished run writes stl+glb+step+manifest; navigate on the mesh,
      // and re-read whatever file is already on screen if it was rewritten.
      if (NIFTI_NAV_RE.test(rel)) {
        if (/\/nifti\//i.test(rel)) {
          // A new imported volume: open it in the Medical View.
          persistOpen(true)
          setMode("medical")
          setSelectedPath(rel)
          setSelectedCaseID(caseIDForPath(rel))
          setMedPath(rel)
        } else if (mode() === "medical" && medPath()) {
          // A segmentation mask landed: reload the current volume's overlays.
          const p = medPath()!
          setMedPath(undefined)
          setMedPath(p)
        }
      } else if (mode() === "medical" && /labels\.json$/i.test(rel) && medPath()) {
        const p = medPath()!
        setMedPath(undefined)
        setMedPath(p)
      } else if (JOB_NAV_RE.test(rel)) {
        // A slice finished: show the job, not the mesh it came from.
        persistOpen(true)
        setMode("print")
        setSelectedPath(rel)
        setSelectedCaseID(caseIDForPath(rel))
        setJobPath(undefined)
        setJobPath(rel)
      } else if (mode() === "print" && jobPath() && /\.(stats|layers)\.json$/i.test(rel)) {
        // A sidecar was rewritten for the job on screen; re-read it.
        const current = jobPath()!
        setJobPath(undefined)
        setJobPath(current)
      } else if (MESH_NAV_RE.test(rel)) {
        persistOpen(true)
        setMode("design")
        setSelectedPath(rel)
        setSelectedCaseID(caseIDForPath(rel))
        meshRetries.delete(rel) // a fresh build deserves a fresh retry budget
        void openMesh(rel)
      } else if (docPath() === rel) {
        void openDoc(rel)
      } else if (/\.manifest\.json$/i.test(rel)) {
        void refreshManifest()
      }
    })
    void api.watch(dir)

    onCleanup(() => {
      unsubStatus()
      unsubArtifact()
      void api.unwatch()
    })
  })

  const headerTitle = () => {
    const m = mode()
    if (m === "design") return meshPath() ?? "Design View"
    if (m === "files") return docPath() ?? selectedCase()?.name ?? "Files"
    if (m === "medical") return medPath() ?? "Medical View"
    if (m === "print") return jobPath() ?? "Print View"
    if (m) return MODES[m].label
    return "Somatic"
  }

  // Bambu Studio opens a sliced job or a project 3MF; a bare mesh is not its
  // job, and offering it for a NIfTI volume would be nonsense.
  const [bambuAvailable, setBambuAvailable] = createSignal(false)
  onMount(async () => setBambuAvailable(!!(await api?.bambuAvailable?.())))
  // Print View offers the sliced job; Design View offers whatever is on screen
  // and lets the main process resolve the .3mf beside it. Restricting this to
  // paths already ending in .3mf hid the button for every .glb — which is the
  // usual thing to be looking at.
  const bambuTarget = () => {
    const m = mode()
    if (m === "print") return jobPath()
    if (m === "design") return meshPath()
    return undefined
  }
  const openInBambu = async () => {
    const target = bambuTarget()
    const dir = sdk().directory
    if (!api || !target || !dir) return
    const result = await api.openInBambu(dir, target)
    if (!result?.ok) {
      setBambuError(result?.error ?? "Bambu Studio could not be started.")
      return
    }
    // A real launch is how the renderer learns the slicer was installed since
    // the last check, so the button stops looking unavailable.
    if (result.launched === "app" && !bambuAvailable()) setBambuAvailable(true)
  }
  const [bambuError, setBambuError] = createSignal<string>()

  // The Design View's model can also go to a real editor: Blender for mesh
  // work, FreeCAD for the B-rep. The main process picks the best sibling
  // artifact itself (step > stl > 3mf), so the button just names the app.
  // A missing app does not hide its button — it dims, and the click opens the
  // official download page; the next click after installing opens the design.
  const [cadApps, setCadApps] = createSignal({ blender: false, freecad: false })
  onMount(async () => {
    const apps = await api?.cadAppsAvailable?.()
    if (apps) setCadApps(apps)
  })
  const designTarget = () => (mode() === "design" ? meshPath() : undefined)
  const cadAppTitle = (app: "blender" | "freecad") => {
    const name = app === "blender" ? "Blender" : "FreeCAD"
    if (!cadApps()[app]) return `${name} is not installed — click to download it, then click again to open`
    return `Open ${designTarget()} in ${name}`
  }
  const openInCadApp = async (app: "blender" | "freecad") => {
    const target = designTarget()
    const dir = sdk().directory
    if (!api?.openInCadApp || !target || !dir) return
    const result = await api.openInCadApp(dir, target, app)
    if (!result?.ok) {
      setBambuError(result?.error ?? `${app === "blender" ? "Blender" : "FreeCAD"} could not be started.`)
      return
    }
    // The main process re-probes on every click, so a launch after an install
    // is how the renderer finds out the app arrived — undim the button.
    if (result.launched === "app" && !cadApps()[app]) setCadApps({ ...cadApps(), [app]: true })
  }

  return (
    <Show when={api}>
      <Show
        when={open()}
        fallback={
          <div class="hidden md:flex h-full w-8 shrink-0 flex-col items-center border-l border-border-weaker-base bg-background-base pt-2">
            <button
              type="button"
              class="text-text-weak hover:text-text-base"
              title="Show preview"
              onClick={() => persistOpen(true)}
            >
              <Icon name="sidebar-right" class="size-4" />
            </button>
          </div>
        }
      >
        <div
          // A curved, inset surface rather than a full-bleed wall: the panel
          // reads as the instrument you are working in, and the gap gives the
          // chat column a visible edge to end against.
          class="relative hidden md:flex h-full shrink-0 flex-col overflow-hidden rounded-xl border border-border-weaker-base bg-background-base my-1.5 mr-1.5 shadow-[0_1px_12px_rgba(0,0,0,0.28)]"
          // Expanded, the panel claims the full row. The chat column is `flex-1 min-w-0`,
          // so it collapses to nothing — the preview takes over the window without this
          // component reaching into its siblings.
          style={{ width: expanded() ? "100%" : `${width()}px` }}
        >
          <div class="flex items-center gap-1 px-2 h-8 shrink-0 border-b border-border-weaker-base" data-tour="views">
            {MODE_ORDER.map((id) => {
              const def = MODES[id]
              return (
                <button
                  type="button"
                  class="shrink-0 flex h-6 items-center gap-1.5 rounded px-1.5"
                  classList={{
                    "text-text-base bg-background-stronger-base": mode() === id,
                    "text-text-weak hover:text-text-base": def.ready && mode() !== id,
                    "text-text-weak opacity-40 cursor-default": !def.ready,
                  }}
                  title={def.ready ? def.label : `${def.label} — soon`}
                  aria-pressed={mode() === id}
                  disabled={!def.ready}
                  onClick={() => selectMode(id)}
                >
                  {modeIcon(id, "size-4")}
                  <Show when={expanded()}>
                    <span class="text-12-regular">{def.label}</span>
                  </Show>
                </button>
              )
            })}
            <div class="text-12-regular text-text-weak flex-1 truncate text-center px-2" title={headerTitle()}>
              {headerTitle()}
            </div>
            <Show when={status().kind === "running"}>
              <div class="text-12-regular text-text-weak shrink-0">rebuilding…</div>
            </Show>
            <Show when={status().kind === "error"}>
              <div class="text-12-regular text-red-500 shrink-0">build failed</div>
            </Show>
            {/* The Design View model opens in a real editor for work this
                panel does not attempt: sculpting in Blender, feature edits on
                the STEP in FreeCAD. Both buttons always show with a design
                loaded — a dimmed one means "not installed", and clicking it
                opens the download page instead of the app. */}
            <Show when={designTarget()}>
              <button
                type="button"
                class="shrink-0 flex h-6 items-center gap-1.5 rounded px-1.5 text-text-weak hover:text-text-base"
                classList={{ "opacity-50": !cadApps().blender }}
                title={cadAppTitle("blender")}
                onClick={() => void openInCadApp("blender")}
              >
                <BlenderIcon class="size-4" />
                <Show when={expanded()}>
                  <span class="text-12-regular">Blender</span>
                </Show>
              </button>
              <button
                type="button"
                class="shrink-0 flex h-6 items-center gap-1.5 rounded px-1.5 text-text-weak hover:text-text-base"
                classList={{ "opacity-50": !cadApps().freecad }}
                title={cadAppTitle("freecad")}
                onClick={() => void openInCadApp("freecad")}
              >
                <FreeCADIcon class="size-4" />
                <Show when={expanded()}>
                  <span class="text-12-regular">FreeCAD</span>
                </Show>
              </button>
            </Show>
            {/* A sliced job or a project can be opened in the slicer itself —
                for the checks that belong there (per-layer speeds, seam
                placement) rather than being reimplemented here. */}
            {/* Shown whenever there is a job to open, installed or not: a
                hidden button teaches nobody that the slicer is what is
                missing. Dimmed means "not installed", and clicking it goes to
                the download page — same contract as Blender and FreeCAD. */}
            <Show when={bambuTarget()}>
              <button
                type="button"
                class="shrink-0 flex h-6 items-center gap-1.5 rounded px-1.5 text-text-weak hover:text-text-base"
                classList={{ "opacity-50": !bambuAvailable() }}
                title={
                  bambuAvailable()
                    ? `Open ${bambuTarget()} in Bambu Studio`
                    : "Bambu Studio is not installed — click to download it, then click again to open"
                }
                onClick={() => void openInBambu()}
              >
                <BambuStudioIcon class="size-4" />
                <Show when={expanded()}>
                  <span class="text-12-regular">Open in Bambu Studio</span>
                </Show>
              </button>
            </Show>
            <button
              type="button"
              class="shrink-0 flex items-center text-text-weak hover:text-text-base p-1"
              title={expanded() ? "Restore split view" : "Expand preview"}
              aria-pressed={expanded()}
              onClick={() => persistExpanded(!expanded())}
            >
              <Show when={expanded()} fallback={<ExpandDiagonalIcon class="size-4" />}>
                <CollapseDiagonalIcon class="size-4" />
              </Show>
            </button>
            <button
              type="button"
              class="shrink-0 flex items-center text-text-weak hover:text-text-base p-1"
              title={mode() ? "Back to launcher" : "Close preview"}
              onClick={() => (mode() ? setMode(null) : closePanel())}
            >
              <Icon name="close" class="size-4" />
            </button>
          </div>

          {/* A failed launch used to be a truncated chip in the header, which
              read as nothing happening at all. It gets a full line here, with
              room for the reason and what to do about it. */}
          <Show when={bambuError()}>
            {(message) => (
              <div class="shrink-0 flex items-start gap-2 px-3 py-2 border-b border-border-weaker-base bg-[rgba(220,38,38,0.08)]">
                <div class="flex-1 text-12-regular text-red-400">{message()}</div>
                <button
                  type="button"
                  class="shrink-0 flex items-center text-text-weak hover:text-text-base"
                  title="Dismiss"
                  onClick={() => setBambuError(undefined)}
                >
                  <Icon name="close" class="size-3.5" />
                </button>
              </div>
            )}
          </Show>

          <Show when={mode() === null}>
            <Coder3dLauncher
              terminalKeys={command.keybindParts("terminal.toggle")}
              onSelect={selectMode}
              quickStartLabel={quickStart() ? "Start with the demo scan" : undefined}
              onQuickStart={quickStart() ? () => openQuickStart() : undefined}
            />
          </Show>

          <Show when={mode() === "medical"}>
            <Show
              when={medPath()}
              keyed
              fallback={
                <div class="flex-1 min-h-0 flex items-center justify-center px-8">
                  {/* Imaging is the one tool not installed up front - it is the
                      largest by far. Offer it here, where a scan would be
                      opened, rather than making everyone wait for it. */}
                  <Show when={hasTool("imaging")} fallback={<ToolOffer id="imaging" title="Medical imaging is not installed yet" />}>
                  <div class="flex flex-col items-center gap-3 max-w-72">
                    <div class="text-12-regular text-text-weak text-center">
                      No scan open. A DICOM folder is converted to NIfTI on import, so the viewer always opens a
                      .nii.gz.
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class="text-12-regular rounded px-2 py-1 bg-background-stronger-base text-text-base hover:bg-background-strongest-base"
                        onClick={() => selectMode("files")}
                      >
                        Open a scan
                      </button>
                      {/* Picking the folder is the part only the OS can do;
                          the conversion itself belongs to the imaging tools,
                          so this hands the chosen path to the agent. */}
                      <button
                        type="button"
                        class="text-12-regular rounded px-2 py-1 bg-background-stronger-base text-text-base hover:bg-background-strongest-base"
                        onClick={() => void importDicomFolder()}
                      >
                        Import DICOM folder…
                      </button>
                    </div>
                    <Show when={importHint()}>
                      {(hint) => <div class="text-11-regular text-text-weak text-center">{hint()}</div>}
                    </Show>
                  </div>
                  </Show>
                </div>
              }
            >
              {(p) => <MedicalView dir={sdk().directory!} volumePath={p} readFile={api!.readFile} />}
            </Show>
          </Show>

          <Show when={mode() === "print"}>
            <Show
              when={jobPath()}
              keyed
              fallback={
                <div class="flex-1 min-h-0 flex items-center justify-center px-8">
                  <div class="flex flex-col items-center gap-3 max-w-72">
                    <div class="text-12-regular text-text-weak text-center">
                      No sliced job open{activeCaseName() ? ` for ${activeCaseName()}` : ""}. Ask the agent to
                      slice a gated mesh, or open one from Files.
                    </div>
                    <div class="flex items-center gap-2">
                      <Show when={caseJob()}>
                        {(job) => (
                          <button
                            type="button"
                            class="text-12-regular rounded px-2 py-1 bg-background-stronger-base text-text-base hover:bg-background-strongest-base"
                            onClick={() => setJobPath(job())}
                          >
                            Open the sliced job{activeCaseName() ? ` for ${activeCaseName()}` : ""}
                          </button>
                        )}
                      </Show>
                      <button
                        type="button"
                        class="text-12-regular rounded px-2 py-1 bg-background-stronger-base text-text-base hover:bg-background-strongest-base"
                        onClick={() => selectMode("files")}
                      >
                        Browse Files
                      </button>
                    </div>
                  </div>
                </div>
              }
            >
              {(job) => <PrintView dir={sdk().directory!} job={job} readFile={api!.readFile} />}
            </Show>
          </Show>

          <Show when={mode() === "design"}>
            <div class="flex-1 min-w-0 min-h-0 flex relative">
              <div class="flex-1 min-w-0 min-h-0 flex flex-col relative">
                {/* Keyed on the PATH, not on the state object: a rebuild or a
                    retry re-reads the same file, and remounting the viewer for
                    that would spin up a fresh WebGL context every time. */}
                <Show
                  when={meshState() && meshPath()}
                  keyed
                  fallback={
                    <div class="absolute inset-0 flex items-center justify-center px-8">
                      <div class="flex flex-col items-center gap-3 max-w-72">
                        <div class="text-12-regular text-text-weak text-center">
                          No model open. Ask the agent to design something, or open one from Files.
                        </div>
                        <div class="flex items-center gap-2">
                          <Show when={caseModel()}>
                            {(model) => (
                              <button
                                type="button"
                                class="text-12-regular rounded px-2 py-1 bg-background-stronger-base text-text-base hover:bg-background-strongest-base"
                                onClick={() => void openMesh(model())}
                              >
                                Open the model{activeCaseName() ? ` for ${activeCaseName()}` : ""}
                              </button>
                            )}
                          </Show>
                          <button
                            type="button"
                            class="text-12-regular rounded px-2 py-1 bg-background-stronger-base text-text-base hover:bg-background-strongest-base"
                            onClick={() => selectMode("files")}
                          >
                            Browse Files
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                >
                  {(_path) => <FilePreview state={meshState()!} onMeshLoadError={retryMesh} />}
                </Show>
              </div>
              {/* The parameter sidebar used to sit here. Removed on request:
                  the Design View is for looking at the model, and dimension
                  changes go through the agent or the CAD script. ParamSidebar
                  and runWithParams are kept so restoring it is one <Show>. */}
            </div>
          </Show>

          <Show when={mode() === "files"}>
            <div class="flex-1 min-h-0 flex">
              <div
                class="relative h-full shrink-0 border-r border-border-weaker-base overflow-hidden flex flex-col"
                style={{ width: !expanded() && !docState() ? "100%" : expanded() ? `${treeWidth()}px` : "46%" }}
              >
                <CaseNavigator
                  cases={cases()}
                  files={listing().files}
                  activePath={selectedPath()}
                  selectedCaseID={selectedCase()?.id}
                  gateStatuses={gateStatuses()}
                  truncated={listing().truncated}
                  onOpen={openFromTree}
                  onSelectCase={(id) => {
                    setSelectedCaseID(id)
                    setDocPath(undefined)
                    setDocState(undefined)
                  }}
                  onRefresh={() => void refreshListing()}
                />
                <Show when={expanded() || docState()}>
                  <ResizeHandle
                    direction="horizontal"
                    edge="end"
                    size={treeWidth()}
                    min={260}
                    max={520}
                    onResize={(w) => {
                      setTreeWidth(w)
                      localStorage.setItem(TREE_WIDTH_KEY, String(w))
                    }}
                  />
                </Show>
              </div>
              <Show when={expanded() || docState()}>
                <div class="flex-1 min-w-0 min-h-0 flex flex-col relative">
                  <Show
                    when={docState()}
                    keyed
                    fallback={
                      <CaseOverview
                        summary={selectedCase()}
                        activePath={selectedPath()}
                        gateStatuses={gateStatuses()}
                        onOpen={openFromTree}
                      />
                    }
                  >
                    {(state) => <FilePreview state={state} />}
                  </Show>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={mode() === "terminal"}>
            <div class="flex-1 min-h-0 flex flex-col">
              <TerminalPanelV2 stacked={false} />
            </div>
          </Show>

          <Show when={status().kind === "error" && status().message}>
            <div class="max-h-32 shrink-0 overflow-y-auto border-t border-border-weaker-base px-3 py-2">
              <div class="text-12-regular text-red-500 whitespace-pre-wrap break-words">{status().message}</div>
            </div>
          </Show>
          <Show when={!expanded()}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={width()}
              min={320}
              max={1600}
              onResize={(w) => {
                setWidth(w)
                localStorage.setItem(WIDTH_KEY, String(w))
              }}
            />
          </Show>
        </div>
      </Show>
    </Show>
  )
}
