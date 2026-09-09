import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { WslServersPlatform } from "@opencode-ai/app/wsl/types"
import type { UpdaterState } from "@opencode-ai/app/updater"
import type { DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@opencode-ai/app/wsl/types"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type WslServersAPI = WslServersPlatform
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}
export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

// 3D-Coder vendor types — the preview-panel bridge (ported Paperino pattern).
export type Coder3dStatus = {
  kind: "idle" | "running" | "done" | "error"
  script?: string
  manifestPath?: string
  message?: string
}
export type Coder3dListFilesResult = { files: string[]; truncated: boolean }
export type Coder3dReadFileResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: "invalid-path" | "not-found" | "too-large" }
// Mirror of main/coder3d/claude-chat-protocol.ts ClaudeChatEvent — preload
// cannot import from the main bundle, so the union is declared on both sides.
export type Coder3dClaudeEvent =
  | { type: "init"; sessionId: string; model: string }
  | { type: "text-delta"; text: string }
  | { type: "assistant-text"; messageId: string; text: string }
  | { type: "tool-start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool-result"; id: string; isError: boolean; output: string }
  | { type: "result"; ok: boolean; sessionId: string; numTurns: number }
  | { type: "error"; message: string }
  | { type: "user-message"; text: string; images: { name: string; src: string }[] }

/** Which locally authenticated CLI runs a turn. */
export type Coder3dChatAgent = "claude" | "codex"

export type Coder3dClaudeChatAPI = {
  send: (
    dir: string,
    text: string,
    images?: Array<{
      name: string
      mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
      data: string
    }>,
    options?: { agent?: Coder3dChatAgent; model?: string; effort?: string; chatKey?: string },
  ) => Promise<{ ok: boolean; error?: string }>
  stop: () => Promise<void>
  newChat: (dir: string, agent?: Coder3dChatAgent, chatKey?: string) => Promise<void>
  state: (
    dir: string,
    agent?: Coder3dChatAgent,
    chatKey?: string,
  ) => Promise<{
    available: boolean
    // Installed is not the same as usable — a present CLI nobody signed into
    // fails at turn time, so the UI needs both facts to say the right thing.
    signedIn?: boolean
    // Which CLIs this machine actually has, so the picker can grey out the rest.
    agents?: { claude: boolean; codex: boolean }
    sessionId?: string
    running?: boolean
  }>
  history: (dir: string, chatKey?: string) => Promise<Coder3dClaudeEvent[]>
  onEvent: (cb: (event: Coder3dClaudeEvent) => void) => () => void
}

export type Coder3dAPI = {
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  onStatus: (cb: (status: Coder3dStatus) => void) => () => void
  onArtifact: (cb: (absPath: string) => void) => () => void
  listFiles: (dir: string) => Promise<Coder3dListFilesResult>
  readFile: (dir: string, relPath: string) => Promise<Coder3dReadFileResult>
  /** Absolute path of a folder the user chose, or undefined if they cancelled. */
  pickFolder: (title?: string) => Promise<string | undefined>
  cadRun: (scriptAbs: string, params: Record<string, number>) => Promise<void>
  bambuAvailable: () => Promise<boolean>
  openInBambu: (
    dir: string,
    relPath: string,
  ) => Promise<{ ok: boolean; launched?: "app" | "download"; error?: string }>
  cadAppsAvailable: () => Promise<{ blender: boolean; freecad: boolean }>
  // launched tells the renderer what actually happened: "app" opened the
  // design, "download" sent the user to the install page instead.
  openInCadApp: (
    dir: string,
    relPath: string,
    app: "blender" | "freecad",
  ) => Promise<{ ok: boolean; launched?: "app" | "download"; error?: string }>
  claudeChat: Coder3dClaudeChatAPI
}

export type ElectronAPI = {
  coder3d: Coder3dAPI
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: () => Promise<ServerReadyData>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  isFirstLaunchOnboardingPending: () => Promise<boolean>
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null>
  isOldLayoutEligible: () => Promise<boolean>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  checkAppExists: (appName: string) => Promise<boolean>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>
  draftGet: (key: string) => Promise<string | null>
  draftSet: (key: string, value: string) => Promise<void>
  draftDelete: (key: string) => Promise<void>
  draftBlobPut: (data: ArrayBuffer) => Promise<string>
  draftBlobGet: (id: string) => Promise<ArrayBuffer | null>

  getWindowID: () => Promise<string>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openExternal: (url: string) => void
  openLocalFile: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  revealPath: (path: string) => Promise<boolean>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  getWindowFocused: () => Promise<boolean>
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  setForceFocus: (enabled: boolean) => Promise<void>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
  setNativeTranslations: (bundle: DesktopNativeBundle) => Promise<void>
}
