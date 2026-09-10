import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"

/**
 * Getting Somatic's Python tool servers onto this machine, without anyone
 * opening a terminal.
 *
 * The environments are several gigabytes and cannot ship inside an installer,
 * so the app builds them itself. Three tiers, decided in the main process:
 *
 * - **core** blocks the first run. It is about 800 MB and buys CAD, slicing
 *   and the agent bridge, so this screen waits for it.
 * - **background** is mesh. It starts on its own as soon as the core is done
 *   and never blocks anything: mesh repair only matters once there is
 *   geometry to repair, but the capability still has to arrive.
 * - **on demand** is imaging, offered where it is needed, the way the Blender
 *   and Bambu Studio buttons offer themselves.
 */

export type ToolSummary = { id: string; label: string; megabytes: number; purpose: string }

export type ToolchainState = {
  installed: string[]
  missingCore: ToolSummary[]
  missingBackground: ToolSummary[]
  megabytesAhead: number
}

type Progress =
  | { kind: "start"; tool: string; label: string; megabytes: number }
  | { kind: "step"; tool: string; label: string; percent: number }
  | { kind: "log"; tool: string; line: string }
  | { kind: "done"; tool: string }
  | { kind: "error"; tool: string; message: string }

type Bridge = {
  toolchainState: () => Promise<ToolchainState>
  installTools: (ids?: string[]) => Promise<{ ok: boolean; installed: string[]; error?: string }>
  catchUpTools: () => Promise<{ ok: boolean; installed: string[]; error?: string }>
  onToolchainProgress: (fn: (event: Progress) => void) => () => void
  onToolchainState: (fn: (state: ToolchainState) => void) => () => void
}

const bridge = (): Bridge | undefined => (window as { api?: { coder3d?: Bridge } }).api?.coder3d

/** Shared, so the Medical View can ask whether imaging is here yet. */
const [state, setState] = createSignal<ToolchainState>()
const [busy, setBusy] = createSignal<string>()

export const toolchain = state
export const toolsInstalling = busy
export const hasTool = (id: string) => state()?.installed.includes(id) ?? false

export async function refreshToolchain() {
  const value = await bridge()?.toolchainState()
  if (value) setState(value)
  return value
}

/** Install one tool by name. Used by the imaging offer in the Medical View. */
export async function installTool(id: string) {
  const api = bridge()
  if (!api || busy()) return
  setBusy(id)
  try {
    await api.installTools([id])
  } finally {
    setBusy(undefined)
    await refreshToolchain()
  }
}

const gigabytes = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`)

export function ToolSetup() {
  // Kept apart from the raw event: uv's log lines arrive between steps, and
  // reading the label off the latest event of any kind blanks it back to
  // "Starting" every time one does.
  const [step, setStep] = createSignal("Starting")
  const [percent, setPercent] = createSignal(0)
  const [failed, setFailed] = createSignal<string>()
  const [running, setRunning] = createSignal(false)

  const needsCore = () => (state()?.missingCore.length ?? 0) > 0

  /** Mesh, quietly, once the core is in place. Never blocks the window. */
  const catchUp = async () => {
    const api = bridge()
    if (!api) return
    if ((state()?.missingBackground.length ?? 0) === 0) return
    await api.catchUpTools()
    await refreshToolchain()
  }

  const startCore = async () => {
    const api = bridge()
    if (!api || running()) return
    setRunning(true)
    setFailed(undefined)
    const result = await api.installTools()
    setRunning(false)
    if (!result?.ok) {
      setFailed(result?.error ?? "The install did not finish.")
      return
    }
    await refreshToolchain()
    void catchUp()
  }

  onMount(async () => {
    const api = bridge()
    if (!api) return
    const offProgress = api.onToolchainProgress((event) => {
      if (event.kind === "step") {
        setStep(event.label)
        setPercent(event.percent)
      }
      if (event.kind === "error") setFailed(event.message)
    })
    const offState = api.onToolchainState((value) => setState(value))
    onCleanup(() => {
      offProgress()
      offState()
    })

    const value = await refreshToolchain()
    // A machine that already has its core tools still finishes what it
    // deferred, so a half-provisioned install repairs itself on next launch.
    if (value && value.missingCore.length === 0) void catchUp()
  })

  // Start as soon as we know something is missing: there is nothing to decide
  // here, and an install that needs a button press is one nobody finishes.
  createEffect(() => {
    if (needsCore() && !running() && !failed()) void startCore()
  })

  const coreMegabytes = () => (state()?.missingCore ?? []).reduce((n, t) => n + t.megabytes, 0)

  return (
    <Show when={needsCore()}>
      <Portal>
        <Style />
        <div class="ts-backdrop" role="presentation">
          <div class="ts-card" role="dialog" aria-modal="true" aria-labelledby="ts-title">
            <div id="ts-title" class="ts-title">
              Setting up Somatic's tools
            </div>
            <div class="ts-body">
              This happens once. Somatic is building the Python environments it designs and slices with, about{" "}
              {gigabytes(coreMegabytes())} in all. Nothing else is needed from you.
            </div>

            <div class="ts-bar" role="progressbar" aria-valuenow={percent()} aria-valuemin={0} aria-valuemax={100}>
              <div class="ts-fill" style={{ width: `${percent()}%` }} />
            </div>
            <div class="ts-step">
              <span>{step()}</span>
              <span class="ts-pct">{percent()}%</span>
            </div>

            <ul class="ts-list">
              <For each={state()?.missingCore ?? []}>
                {(tool) => (
                  <li data-done={hasTool(tool.id) ? "" : undefined}>
                    <span class="ts-tick">{hasTool(tool.id) ? "✓" : "·"}</span>
                    <span class="ts-name">{tool.label}</span>
                    <span class="ts-why">{tool.purpose}</span>
                  </li>
                )}
              </For>
            </ul>

            <Show when={failed()}>
              {(message) => (
                <div class="ts-error">
                  <div>{message()}</div>
                  <button type="button" class="ts-retry" onClick={() => void startCore()}>
                    Try again
                  </button>
                </div>
              )}
            </Show>

            <Show when={(state()?.missingBackground.length ?? 0) > 0}>
              <div class="ts-later">
                Mesh inspection and repair downloads afterwards, on its own. You can start working before it finishes.
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

/**
 * The offer shown where a missing tool is actually wanted - the Medical View,
 * for imaging. Same bargain as the Blender and Bambu Studio buttons: the
 * capability is always visible, and choosing it is what installs it.
 */
export function ToolOffer(props: { id: string; title: string }) {
  const tool = () =>
    [...(state()?.missingCore ?? []), ...(state()?.missingBackground ?? [])].find((t) => t.id === props.id)
  const installing = () => busy() === props.id

  return (
    <Show when={!hasTool(props.id)}>
      <Style />
      <div class="ts-offer">
        <div class="ts-offer-title">{props.title}</div>
        <div class="ts-offer-why">{tool()?.purpose ?? "This tool has not been installed yet."}</div>
        <button type="button" class="ts-offer-btn" disabled={installing()} onClick={() => void installTool(props.id)}>
          {installing() ? "Installing…" : `Install (${gigabytes(tool()?.megabytes ?? 0)})`}
        </button>
        <div class="ts-offer-note">
          Downloaded once, then it stays. Segmentation fetches its models the first time it runs.
        </div>
      </div>
    </Show>
  )
}

function Style() {
  return (
    <style>{`
      .ts-backdrop {
        position: fixed; inset: 0; z-index: 1100;
        display: flex; align-items: center; justify-content: center; padding: 24px;
        background: color-mix(in srgb, var(--background-base) 62%, transparent);
        backdrop-filter: blur(10px);
      }
      .ts-card {
        width: min(520px, 100%);
        background: color-mix(in srgb, var(--background-strong) 88%, transparent);
        backdrop-filter: blur(28px) saturate(140%);
        border: 1px solid color-mix(in srgb, var(--border-weak-base) 60%, transparent);
        border-radius: 16px; padding: 22px;
        box-shadow: 0 24px 80px -24px rgba(0, 0, 0, 0.45);
        color: var(--text-base);
        display: flex; flex-direction: column; gap: 14px;
      }
      .ts-title { font-size: 17px; font-weight: 600; letter-spacing: -0.014em; }
      .ts-body { font-size: 13px; line-height: 1.55; color: var(--text-weak); }
      .ts-bar { height: 6px; border-radius: 999px; background: var(--surface-inset-base); overflow: hidden; }
      .ts-fill { height: 100%; background: #2dd4bf; border-radius: 999px; transition: width 240ms ease; }
      .ts-step { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-weak); }
      .ts-pct { font-variant-numeric: tabular-nums; }
      .ts-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
      .ts-list li { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--text-weak); }
      .ts-list li[data-done] .ts-name { color: var(--text-base); }
      .ts-tick { width: 12px; color: #2dd4bf; }
      .ts-name { min-width: 92px; }
      .ts-why { flex: 1; opacity: 0.8; }
      .ts-error {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        font-size: 12px; color: #f87171;
        background: rgba(220, 38, 38, 0.08); border-radius: 8px; padding: 10px 12px;
      }
      .ts-retry {
        font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 7px; cursor: pointer;
        border: 1px solid #14b8a6; background: #14b8a6; color: #04201c; font-weight: 600;
      }
      .ts-later { font-size: 12px; color: var(--text-weak); opacity: 0.85; }

      .ts-offer {
        max-width: 420px; margin: auto; text-align: center;
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        padding: 22px;
      }
      .ts-offer-title { font-size: 15px; font-weight: 600; color: var(--text-base); }
      .ts-offer-why { font-size: 13px; line-height: 1.5; color: var(--text-weak); }
      .ts-offer-btn {
        font: inherit; font-size: 13px; padding: 9px 16px; border-radius: 8px; cursor: pointer;
        border: 1px solid #14b8a6; background: #14b8a6; color: #04201c; font-weight: 600;
      }
      .ts-offer-btn:disabled { opacity: 0.6; cursor: default; }
      .ts-offer-note { font-size: 11px; color: var(--text-weak); opacity: 0.8; }
    `}</style>
  )
}
