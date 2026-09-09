import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { Coder3dClaudeEvent, Coder3dStatus, ElectronAPI, WslServersEvent } from "./types"
import type { UpdaterState } from "@opencode-ai/app/updater"

const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
const updaterHandler = (_: unknown, state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}

const api: ElectronAPI = {
  coder3d: {
    watch: (dir) => ipcRenderer.invoke("coder3d-watch", dir),
    unwatch: () => ipcRenderer.invoke("coder3d-unwatch"),
    onStatus: (cb) => {
      const handler = (_: unknown, status: Coder3dStatus) => cb(status)
      ipcRenderer.on("coder3d-status", handler)
      return () => ipcRenderer.removeListener("coder3d-status", handler)
    },
    onArtifact: (cb) => {
      const handler = (_: unknown, absPath: string) => cb(absPath)
      ipcRenderer.on("coder3d-artifact", handler)
      return () => ipcRenderer.removeListener("coder3d-artifact", handler)
    },
    listFiles: (dir) => ipcRenderer.invoke("coder3d-list-files", dir),
    readFile: (dir, relPath) => ipcRenderer.invoke("coder3d-read-file", dir, relPath),
    pickFolder: (title) => ipcRenderer.invoke("coder3d-pick-folder", title),
    cadRun: (scriptAbs, params) => ipcRenderer.invoke("coder3d-cad-run", scriptAbs, params),
    bambuAvailable: () => ipcRenderer.invoke("coder3d-bambu-available"),
    openInBambu: (dir, relPath) => ipcRenderer.invoke("coder3d-open-in-bambu", dir, relPath),
    cadAppsAvailable: () => ipcRenderer.invoke("coder3d-cad-apps-available"),
    openInCadApp: (dir, relPath, app) => ipcRenderer.invoke("coder3d-open-in-cad-app", dir, relPath, app),
    claudeChat: {
      send: (dir, text, images, options) =>
        ipcRenderer.invoke("coder3d-claude-send", dir, text, images, options),
      stop: () => ipcRenderer.invoke("coder3d-claude-stop"),
      newChat: (dir, agent, chatKey) => ipcRenderer.invoke("coder3d-claude-new-chat", dir, agent, chatKey),
      state: (dir, agent, chatKey) => ipcRenderer.invoke("coder3d-claude-state", dir, agent, chatKey),
      history: (dir, chatKey) => ipcRenderer.invoke("coder3d-claude-history", dir, chatKey),
      onEvent: (cb) => {
        const handler = (_: unknown, event: Coder3dClaudeEvent) => cb(event)
        ipcRenderer.on("coder3d-claude-event", handler)
        return () => ipcRenderer.removeListener("coder3d-claude-event", handler)
      },
    },
  },
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: () => ipcRenderer.invoke("await-initialization"),
  wslServers: {
    getState: () => ipcRenderer.invoke("wsl-servers-get-state"),
    subscribe: (cb) => {
      const handler = (_: unknown, event: WslServersEvent) => cb(event)
      ipcRenderer.on("wsl-servers-event", handler)
      void ipcRenderer.invoke("wsl-servers-subscribe")
      return () => {
        ipcRenderer.removeListener("wsl-servers-event", handler)
        void ipcRenderer.invoke("wsl-servers-unsubscribe")
      }
    },
    probeRuntime: () => ipcRenderer.invoke("wsl-servers-probe-runtime"),
    refreshDistros: () => ipcRenderer.invoke("wsl-servers-refresh-distros"),
    installWsl: () => ipcRenderer.invoke("wsl-servers-install-wsl"),
    installDistro: (name) => ipcRenderer.invoke("wsl-servers-install-distro", name),
    probeAddable: (distros) => ipcRenderer.invoke("wsl-servers-probe-addable", distros),
    installOpencode: (name) => ipcRenderer.invoke("wsl-servers-install-opencode", name),
    openTerminal: (name) => ipcRenderer.invoke("wsl-servers-open-terminal", name),
    addServer: (distro) => ipcRenderer.invoke("wsl-servers-add", distro),
    removeServer: (id) => ipcRenderer.invoke("wsl-servers-remove", id),
    startServer: (id) => ipcRenderer.invoke("wsl-servers-start", id),
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        ipcRenderer.on("updater-state", updaterHandler)
        updaterSubscription = ipcRenderer.invoke("updater-subscribe")
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        ipcRenderer.removeListener("updater-state", updaterHandler)
        updaterSubscription = undefined
        void ipcRenderer.invoke("updater-unsubscribe")
      }
    },
    check: () => ipcRenderer.invoke("updater-check"),
    install: () => ipcRenderer.invoke("updater-install"),
  },
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  isFirstLaunchOnboardingPending: () => ipcRenderer.invoke("is-first-launch-onboarding-pending"),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    ipcRenderer.invoke("finish-first-launch-onboarding", createDefaultProject),
  isOldLayoutEligible: () => ipcRenderer.invoke("is-old-layout-eligible"),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),
  draftGet: (key) => ipcRenderer.invoke("draft-get", key),
  draftSet: (key, value) => ipcRenderer.invoke("draft-set", key, value),
  draftDelete: (key) => ipcRenderer.invoke("draft-delete", key),
  draftBlobPut: (data) => ipcRenderer.invoke("draft-blob-put", data),
  draftBlobGet: (id) => ipcRenderer.invoke("draft-blob-get", id),

  getWindowID: () => ipcRenderer.invoke("get-window-id"),
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  readPickedFile: (token, path) => ipcRenderer.invoke("read-picked-file", token, path),
  releasePickedFiles: (token) => ipcRenderer.invoke("release-picked-files", token),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  openLocalFile: (url) => ipcRenderer.send("open-local-file", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  getWindowFullscreen: () => ipcRenderer.invoke("get-window-fullscreen"),
  onWindowFullscreenChanged: (cb) => {
    const handler = (_: unknown, fullscreen: boolean) => cb(fullscreen)
    ipcRenderer.on("window-fullscreen-changed", handler)
    return () => ipcRenderer.removeListener("window-fullscreen-changed", handler)
  },
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  getPinchZoomEnabled: () => ipcRenderer.invoke("get-pinch-zoom-enabled"),
  setPinchZoomEnabled: (enabled) => ipcRenderer.invoke("set-pinch-zoom-enabled", enabled),
  onPinchZoomEnabledChanged: (cb) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on("pinch-zoom-enabled-changed", handler)
    return () => ipcRenderer.removeListener("pinch-zoom-enabled-changed", handler)
  },
  onZoomFactorChanged: (cb) => {
    const handler = (_: unknown, factor: number) => cb(factor)
    ipcRenderer.on("zoom-factor-changed", handler)
    return () => ipcRenderer.removeListener("zoom-factor-changed", handler)
  },
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runDesktopMenuAction: (action) => ipcRenderer.invoke("run-desktop-menu-action", action),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  exportDebugLogs: () => ipcRenderer.invoke("export-debug-logs"),
  setForceFocus: (enabled) => ipcRenderer.invoke("set-force-focus", enabled),
  recordFatalRendererError: (error) => ipcRenderer.invoke("record-fatal-renderer-error", error),
  setNativeTranslations: (bundle) => ipcRenderer.invoke("set-native-translations", bundle),
}

contextBridge.exposeInMainWorld("api", api)
