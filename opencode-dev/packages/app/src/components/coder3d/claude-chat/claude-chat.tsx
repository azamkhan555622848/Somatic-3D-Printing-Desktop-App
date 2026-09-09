// The app's default chat: headless Claude Code on the user's own subscription.
// Every turn spawns `claude -p --resume` in the main process (claude-chat.ts)
// and streams back events; this view renders them and owns the composer.
import { For, Show, createEffect, createMemo, createSignal, on, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { BasicToolV2 } from "@opencode-ai/session-ui/v2/basic-tool-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  applyEvent,
  toolDisplay,
  userMessage,
  type ChatMessage,
  type ChatPart,
  type ClaudeChatEvent,
} from "./chat-model"
import { composerAction, composerEnabled, inputEnabled, placeholder, queueFor, takeQueued } from "./composer"
import {
  AGENTS,
  agentDef,
  agentLabel,
  modelLabel,
  readChoice,
  storeChoice,
  type AgentChoice,
  type AgentId,
} from "./agents"
import { PaperclipIcon, StopIcon } from "../panel-icons"

const BACKEND_KEY = "coder3d-chat-backend"

// Somatic runs on Claude Code and Codex only. The built-in opencode chat is a
// different assistant on different models, and switching to it stranded people
// outside the agent picker with no obvious way back. The signal stays so the
// existing call sites keep compiling, but it is pinned.
const [backend] = createSignal<"claude" | "glm">("claude")
// A stale "glm" from before this change would otherwise strand someone in a
// chat whose toggle no longer exists.
try {
  localStorage.removeItem(BACKEND_KEY)
} catch {
  // Blocked storage just means nothing to clear.
}

export function useChatBackend() {
  const set = (_value: "claude" | "glm") => {
    // Intentionally inert: there is one chat now.
  }
  return [backend, set] as const
}

type Bridge = {
  send(
    dir: string,
    text: string,
    images?: ClaudeChatImage[],
    options?: { agent?: AgentId; model?: string; effort?: string; chatKey?: string },
  ): Promise<{ ok: boolean; error?: string }>
  stop(): Promise<void>
  newChat(dir: string, agent?: AgentId, chatKey?: string): Promise<void>
  state(
    dir: string,
    agent?: AgentId,
    chatKey?: string,
  ): Promise<{
    available: boolean
    signedIn?: boolean
    agents?: Record<AgentId, boolean>
    sessionId?: string
    running?: boolean
  }>
  // Optional: a renderer hot-reloaded onto an older preload has no history().
  history?(dir: string, chatKey?: string): Promise<ClaudeChatEvent[]>
  onEvent(cb: (event: ClaudeChatEvent) => void): () => void
}

type ClaudeImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp"
type ClaudeChatImage = { name: string; mime: ClaudeImageMime; data: string }
type ComposerImage = ClaudeChatImage & { id: string; preview: string; size: number }

const IMAGE_LIMIT = 4
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp"
const IMAGE_MIMES = new Set<ClaudeImageMime>(["image/jpeg", "image/png", "image/gif", "image/webp"])
const EXTENSION_MIME: Record<string, ClaudeImageMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
}

function fileMime(file: File): ClaudeImageMime | undefined {
  if (IMAGE_MIMES.has(file.type as ClaudeImageMime)) return file.type as ClaudeImageMime
  return EXTENSION_MIME[file.name.split(".").pop()?.toLowerCase() ?? ""]
}

function readDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("invalid image"))
    reader.onerror = () => reject(reader.error ?? new Error("failed to read image"))
    reader.readAsDataURL(file)
  })
}

const userImages = (message: ChatMessage) =>
  message.parts.filter((part): part is Extract<ChatPart, { kind: "image" }> => part.kind === "image")
const userText = (message: ChatMessage) =>
  message.parts
    .filter((part): part is Extract<ChatPart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("")

const bridge = (): Bridge | undefined =>
  (window as { api?: { coder3d?: { claudeChat?: Bridge } } }).api?.coder3d?.claudeChat

// The transcript lives at module scope, keyed by workspace: the chat column
// remounts on tab and layout changes, and a turn keeps streaming while it is
// unmounted. Component-local state would drop both. One subscription is
// attached here for the same reason (remounting must not stack IPC listeners).
const [transcripts, setTranscripts] = createSignal<Record<string, ChatMessage[]>>({})
// The conversation currently streaming, identified by its session key.
const [runningKey, setRunningKey] = createSignal<string>()

// Which agent and model run each turn. Module scope for the same reason as the
// transcript: the header must survive a remount, and the value is read by the
// send path. Persisted so a restart keeps the operator's choice.
const [choice, setChoice] = createSignal<AgentChoice>(readChoice())
const applyChoice = (next: AgentChoice) => {
  setChoice(next)
  storeChoice(next)
}
// Which CLIs this machine actually has; undefined until the first state call.
const [installed, setInstalled] = createSignal<Record<AgentId, boolean>>()
const agentInstalled = (agent: AgentId): boolean | undefined => installed()?.[agent]

// Messages typed while a turn is in flight. `claude -p` runs one turn at a
// time, so they wait here and go out the moment the turn reports its result.
// The map holds the data; the signal exists only so the view can react.
const queue = new Map<string, { dir: string; text: string; images: ComposerImage[] }[]>()
const [queuedView, setQueuedView] = createSignal<Record<string, string[]>>({})
const syncQueuedView = (key: string) =>
  setQueuedView((all) => ({ ...all, [key]: (queue.get(key) ?? []).map((item) => item.text) }))

// Text handed to the composer from elsewhere in the app — the Medical View's
// Import button, which knows the folder the user picked but not how to convert
// it. Keyed by workspace so two windows cannot steal each other's text, and
// consumed once: this fills the box, the user still presses Enter.
const prefills = new Map<string, string>()
const [prefillTick, setPrefillTick] = createSignal(0)
export function prefillComposer(dir: string, text: string) {
  prefills.set(dir, text)
  setPrefillTick((tick) => tick + 1)
}

const messagesFor = (dir: string | undefined) => (dir ? (transcripts()[dir] ?? []) : [])
const updateTranscript = (dir: string, update: (current: ChatMessage[]) => ChatMessage[]) =>
  setTranscripts((all) => ({ ...all, [dir]: update(all[dir] ?? []) }))

// Shared by the composer and the queue drain, so a queued turn is indistinguishable
// from one the user sent directly.
async function dispatch(api: Bridge, dir: string, key: string, text: string, images: ComposerImage[]) {
  updateTranscript(key, (list) => [
    ...list,
    userMessage(
      text,
      images.map((image) => ({ name: image.name, src: image.preview })),
    ),
  ])
  setRunningKey(key)
  const picked = choice()
  const result = await api.send(
    dir,
    text,
    images.map(({ name, mime, data }) => ({ name, mime, data })),
    { agent: picked.agent, model: picked.model, effort: picked.effort, chatKey: key },
  )
  if (result.ok) return
  setRunningKey(undefined)
  updateTranscript(key, (list) => applyEvent(list, { type: "error", message: result.error ?? "send failed" }))
}

let subscribed = false
function ensureSubscription(api: Bridge) {
  if (subscribed) return
  subscribed = true
  api.onEvent((event) => {
    const key = runningKey()
    if (!key) return
    updateTranscript(key, (current) => applyEvent(current, event))
    if (event.type !== "result" && event.type !== "error") return
    setRunningKey(undefined)
    const next = takeQueued(queue, key)
    syncQueuedView(key)
    if (next) void dispatch(api, next.dir, key, next.text, next.images)
  })
}

// Tool rows use opencode's own BasicToolV2, so a Claude turn reads exactly
// like a turn in the stock chat: title, subtitle, args, diff counts, and the
// real output one click away.
function ToolRow(props: { part: Extract<ChatPart, { kind: "tool" }> }) {
  const display = createMemo(() => toolDisplay(props.part))
  const status = () => (props.part.state === "running" ? "running" : props.part.state === "error" ? "error" : "done")
  return (
    <BasicToolV2
      trigger={{
        title: display().title,
        subtitle: display().subtitle,
        args: display().args,
        changes: display().changes,
      }}
      status={status()}
      defaultOpen={false}
    >
      <Show when={display().body}>
        <pre
          class="max-h-80 overflow-auto whitespace-pre-wrap break-words px-1 py-1 text-12-regular"
          classList={{
            "text-red-500": props.part.state === "error",
            "text-text-weak": props.part.state !== "error",
          }}
        >
          {display().body}
        </pre>
      </Show>
    </BasicToolV2>
  )
}

export function ClaudeChat(props: { sessionID?: string }) {
  const sdk = useSDK()
  const language = useLanguage()
  const api = bridge()
  if (api) ensureSubscription(api)

  const dir = () => sdk().directory
  // One conversation per opencode session, which is what the sidebar lists.
  // Before an id exists (the "New session" route) the chat gets a per-mount
  // key, so every New session really does start an empty chat.
  const draftKey = `draft-${Math.random().toString(36).slice(2, 10)}`
  const chatKey = () => `${dir() ?? ""}::${props.sessionID ?? draftKey}`
  const messages = () => messagesFor(chatKey())
  const running = () => runningKey() !== undefined && runningKey() === chatKey()
  const [available, setAvailable] = createSignal(true)
  const [signedIn, setSignedIn] = createSignal(true)
  const [resumed, setResumed] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [attachmentState, setAttachmentState] = createStore<{ images: ComposerImage[]; error?: string }>({ images: [] })
  let listEl: HTMLDivElement | undefined
  let inputEl: HTMLTextAreaElement | undefined
  let fileInputEl: HTMLInputElement | undefined

  const scrollToEnd = () => queueMicrotask(() => listEl?.scrollTo({ top: listEl.scrollHeight }))

  onMount(async () => {
    if (!api) return
    const current = dir()
    if (!current) return
    const state = await api.state(current, choice().agent, chatKey())
    setAvailable(state.available)
    setSignedIn(state.signedIn !== false)
    if (state.agents) setInstalled(state.agents)
    setResumed(!!state.sessionId)
    // A turn survives a reload of this window. Without adopting it the composer
    // looks idle, typing is rejected with "a turn is already running", and the
    // events still arriving are dropped on the floor.
    if (state.running) setRunningKey(chatKey())
    // A restart wiped this module's transcript but not Claude Code's own
    // session file — replay it so the conversation picks up where it left off.
    // Re-checked after the await: if a turn started or streamed in meanwhile,
    // seeding now would clobber or duplicate it, so the live content wins.
    // History replay reads Claude Code's own transcript store; Codex keeps its
    // threads elsewhere, so a Codex session resumes without a visible replay.
    if (choice().agent === "claude" && state.sessionId && api.history && messagesFor(chatKey()).length === 0) {
      const events = await api.history(current, chatKey())
      if (events.length > 0)
        updateTranscript(chatKey(), (existing) => (existing.length > 0 ? existing : events.reduce(applyEvent, [])))
    }
    scrollToEnd()
  })

  // Keep the view pinned to the newest output while a turn streams.
  createEffect(() => {
    messages()
    scrollToEnd()
  })

  // Switching agent re-asks whether that CLI exists and whether it already has
  // a conversation here — the answer differs per agent.
  createEffect(
    on(
      () => choice().agent,
      async (agent, previous) => {
        if (previous === undefined || agent === previous) return
        const current = dir()
        if (!api || !current) return
        const state = await api.state(current, agent, chatKey())
        setAvailable(state.available)
        setSignedIn(state.signedIn !== false)
        if (state.agents) setInstalled(state.agents)
        setResumed(!!state.sessionId)
      },
    ),
  )

  // Pick up anything another panel put in the box for this workspace.
  createEffect(() => {
    prefillTick()
    const current = dir()
    if (!current) return
    const text = prefills.get(current)
    if (text === undefined) return
    prefills.delete(current)
    setDraft(text)
    inputEl?.focus()
  })

  const send = async () => {
    const current = dir()
    const text = draft().trim()
    const images = [...attachmentState.images]
    if (!api || !current || (!text && images.length === 0)) return
    setDraft("")
    setAttachmentState({ images: [], error: undefined })
    // A turn is already running: hold this one rather than refusing it. The
    // subscription sends it the moment the turn ends — including when the user
    // ends it with Stop, since "stop and do this instead" is the whole reason
    // for typing mid-turn.
    if (running()) {
      queueFor(queue, chatKey(), { dir: current, text, images })
      syncQueuedView(chatKey())
      return
    }
    await dispatch(api, current, chatKey(), text, images)
  }

  const unqueue = (index: number) => {
    const key = chatKey()
    queue.get(key)?.splice(index, 1)
    if (queue.get(key)?.length === 0) queue.delete(key)
    syncQueuedView(key)
  }

  const composer = () => ({
    running: running(),
    blank: !draft().trim() && attachmentState.images.length === 0,
    available: available(),
    agent: agentLabel(choice().agent),
  })
  const queued = () => queuedView()[chatKey()] ?? []

  const addImages = async (input: FileList | readonly File[]) => {
    const files = Array.from(input)
    if (files.length === 0) return
    const current = [...attachmentState.images]
    const additions: ComposerImage[] = []
    let error: string | undefined

    for (const file of files) {
      if (current.length + additions.length >= IMAGE_LIMIT) {
        error = `You can attach up to ${IMAGE_LIMIT} images per message.`
        break
      }
      const mime = fileMime(file)
      if (!mime) {
        error = language.t("prompt.toast.pasteUnsupported.description")
        continue
      }
      if (file.size > IMAGE_MAX_BYTES) {
        error = `Images must be ${IMAGE_MAX_BYTES / 1024 / 1024} MB or smaller.`
        continue
      }
      const id = `${file.name}:${file.size}:${file.lastModified}`
      if (current.some((image) => image.id === id) || additions.some((image) => image.id === id)) continue
      try {
        const preview = await readDataURL(file)
        const comma = preview.indexOf(",")
        if (comma === -1) throw new Error("invalid image")
        additions.push({ id, name: file.name, mime, size: file.size, preview, data: preview.slice(comma + 1) })
      } catch {
        error = language.t("prompt.toast.pasteUnsupported.description")
      }
    }

    if (additions.length > 0) setAttachmentState("images", [...current, ...additions])
    setAttachmentState("error", error)
    inputEl?.focus()
  }

  const removeImage = (id: string) => {
    setAttachmentState(
      "images",
      attachmentState.images.filter((image) => image.id !== id),
    )
    setAttachmentState("error", undefined)
  }

  const newChat = async () => {
    const current = dir()
    if (!api || !current || running()) return
    await api.newChat(current, choice().agent, chatKey())
    updateTranscript(chatKey(), () => [])
    setResumed(false)
    inputEl?.focus()
  }

  return (
    <div class="relative flex h-full min-h-0 flex-col bg-background-base">
      <div class="relative flex h-9 shrink-0 items-center gap-2 border-b border-border-weaker-base px-3">
        {/* The agent/model picker. Both agents are locally authenticated CLIs
            on the operator's own subscription, so switching is a spawn choice,
            not a credential one. */}
        <button
          type="button"
          class="group flex items-center gap-2 rounded-md border px-2 py-1 transition-colors"
          classList={{
            "border-border-weaker-base bg-background-stronger-base": pickerOpen(),
            "border-transparent hover:border-border-weaker-base hover:bg-background-stronger-base": !pickerOpen(),
          }}
          title="Choose the agent and model that run each turn"
          data-tour="agent"
          aria-haspopup="menu"
          aria-expanded={pickerOpen()}
          onClick={() => setPickerOpen((open) => !open)}
        >
          {/* A live dot, not decoration: it is the one place the header says
              whether this agent can actually take a turn right now. */}
          <span
            class="size-1.5 rounded-full"
            classList={{
              "bg-teal-400": available() && signedIn(),
              "bg-amber-400": available() && !signedIn(),
              "bg-red-500": !available(),
            }}
            aria-hidden="true"
          />
          <span class="text-12-regular font-medium text-text-base">{agentLabel(choice().agent)}</span>
          <span class="text-12-regular text-text-weak">{modelLabel(choice().agent, choice().model)}</span>
          <Show when={agentDef(choice().agent).efforts}>
            <span class="rounded bg-background-strongest-base px-1 text-11-regular text-text-weak">
              {choice().effort}
            </span>
          </Show>
          <Icon
            name="chevron-down"
            class="size-3 text-text-weak transition-transform"
            classList={{ "rotate-180": pickerOpen() }}
          />
        </button>
        <Show when={pickerOpen()}>
          {/* Click-away layer: a menu that only closes via its own items is a
              trap on a panel this small. */}
          <div class="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
          <div class="absolute left-2 top-9 z-50 w-64 rounded-xl border border-border-weaker-base bg-background-base p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
            <For each={AGENTS}>
              {(def) => (
                <div class="mb-1.5 last:mb-0">
                  {/* The requirement sits under the name: which subscription
                      this runs on is the thing a new operator needs to know. */}
                  <div class="flex items-baseline justify-between gap-2 px-2 pb-1 pt-1.5">
                    <span class="text-12-regular font-medium text-text-base">{def.label}</span>
                    <span class="truncate text-11-regular text-text-weak">
                      {agentInstalled(def.id) === false ? "not installed" : def.requirement}
                    </span>
                  </div>
                  <For each={def.models}>
                    {(model) => (
                      <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12-regular transition-colors disabled:opacity-40"
                        classList={{
                          "bg-background-stronger-base text-text-base":
                            choice().agent === def.id && choice().model === model.id,
                          "text-text-weak hover:bg-background-stronger-base hover:text-text-base": !(
                            choice().agent === def.id && choice().model === model.id
                          ),
                        }}
                        disabled={agentInstalled(def.id) === false}
                        title={agentInstalled(def.id) === false ? `Requires ${def.requirement}` : undefined}
                        onClick={() => {
                          applyChoice({ ...choice(), agent: def.id, model: model.id })
                          setPickerOpen(false)
                        }}
                      >
                        {/* A teal bar marks the running pair. Reserved for
                            state, so it never reads as decoration. */}
                        <span
                          class="h-3.5 w-0.5 shrink-0 rounded-full"
                          classList={{
                            "bg-teal-400": choice().agent === def.id && choice().model === model.id,
                            "bg-transparent": !(choice().agent === def.id && choice().model === model.id),
                          }}
                          aria-hidden="true"
                        />
                        <span class="flex-1 truncate">{model.label}</span>
                      </button>
                    )}
                  </For>
                  <Show when={def.efforts && choice().agent === def.id}>
                    <div class="mx-2 mb-1 mt-1.5">
                      <div class="mb-1 text-11-regular text-text-weak">Reasoning effort</div>
                      <div class="flex gap-0.5 rounded-lg bg-background-stronger-base p-0.5">
                        <For each={def.efforts}>
                          {(effort) => (
                            <button
                              type="button"
                              class="flex-1 rounded-md py-0.5 text-11-regular capitalize transition-colors"
                              classList={{
                                "bg-background-strongest-base text-text-base": choice().effort === effort,
                                "text-text-weak hover:text-text-base": choice().effort !== effort,
                              }}
                              aria-pressed={choice().effort === effort}
                              onClick={() => applyChoice({ ...choice(), effort })}
                            >
                              {effort}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <div class="mt-1 border-t border-border-weaker-base px-2 pb-0.5 pt-2 text-11-regular leading-relaxed text-text-weak">
              Each agent keeps its own conversation in this session, on your own subscription. Which models a plan
              allows is set by that subscription, not by Somatic.
            </div>
          </div>
        </Show>
        <div class="flex-1" />
        <Show when={running()}>
          <button
            type="button"
            class="text-12-regular text-text-weak hover:text-text-base"
            onClick={() => void api?.stop()}
          >
            Stop
          </button>
        </Show>
        <button
          type="button"
          class="text-12-regular text-text-weak hover:text-text-base disabled:opacity-40"
          disabled={running()}
          onClick={() => void newChat()}
          title="Start a new Claude conversation for this project"
        >
          New chat
        </button>

      </div>

      {/* Installed-but-signed-out is the likelier state for a new tester, and
          it needs a different instruction from not-installed. Saying "install
          it" to someone who already has it wastes their time. */}
      <Show when={!available() || !signedIn()}>
        <div class="shrink-0 border-b border-border-weaker-base px-3 py-2">
          <Show
            when={available()}
            fallback={
              <div class="text-12-regular text-red-400">
                {agentLabel(choice().agent)} needs {agentDef(choice().agent).requirement}, and the{" "}
                <span class="font-mono">{choice().agent}</span> command is not on PATH. Install it, sign in, then
                restart Somatic — or pick the other agent above.
              </div>
            }
          >
            <div class="text-12-regular text-amber-400">
              {agentLabel(choice().agent)} is installed but not signed in. Run{" "}
              <span class="font-mono">{choice().agent === "codex" ? "codex login" : "claude auth login"}</span> in a
              terminal, then send a message — no restart needed.
            </div>
          </Show>
        </div>
      </Show>

      {/* select-text: the app shell sets select-none for the desktop feel and
          re-enables it only for inputs, so a transcript you cannot copy out of
          is the default. Answers, commands and tool output all live in here. */}
      <div ref={listEl} class="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 select-text">
        <Show when={resumed() && messages().length === 0}>
          <div class="mb-3 text-center text-12-regular text-text-weak">
            Resumed this session's {agentLabel(choice().agent)} conversation — earlier messages stay in{" "}
            {agentDef(choice().agent).product}'s own history.
          </div>
        </Show>
        <Show when={!resumed() && messages().length === 0}>
          <div class="flex h-full items-center justify-center px-8">
            <div class="max-w-72 text-center text-12-regular text-text-weak">
              Ask Claude to design, segment, or print something. It works directly in this workspace with the CAD, mesh,
              and imaging tools.
            </div>
          </div>
        </Show>

        <div class="flex flex-col gap-3 min-w-0">
          <For each={messages()}>
            {(message) => (
              <Show
                when={message.role === "assistant"}
                fallback={
                  <div class="flex justify-end">
                    <div class="flex max-w-[85%] flex-col gap-2 rounded-lg bg-background-stronger-base px-3 py-2 text-14-regular text-text-base">
                      <Show when={userImages(message).length > 0}>
                        <div class="flex flex-wrap gap-2">
                          <For each={userImages(message)}>
                            {(image) => (
                              <img
                                src={image.src}
                                alt={image.name}
                                title={image.name}
                                class="max-h-48 max-w-56 rounded-md border border-border-weaker-base object-contain"
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={userText(message)}>{(text) => <div class="whitespace-pre-wrap">{text()}</div>}</Show>
                    </div>
                  </div>
                }
              >
                <div class="flex flex-col gap-1.5 min-w-0">
                  <For each={message.parts}>
                    {(part) => (
                      <Show
                        when={part.kind === "tool" ? part : undefined}
                        fallback={
                          // A wide markdown table scrolls inside its own box.
                          // Without min-w-0 the flex child refuses to shrink
                          // and the whole chat column grows a horizontal bar.
                          <div class="min-w-0 max-w-full overflow-x-auto">
                            <Markdown
                              text={part.kind === "text" ? part.text : ""}
                              streaming={running()}
                              class="text-14-regular"
                            />
                          </div>
                        }
                      >
                        {/* A tool row's subtitle is a whole shell command, and
                            the shared trigger lays it out in a flex row that
                            will not shrink — measured at 1824px against a
                            743px column. Clip it here rather than let every
                            long command widen the chat. */}
                        {(tool) => (
                          <div class="min-w-0 max-w-full overflow-hidden">
                            <ToolRow part={tool()} />
                          </div>
                        )}
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
            )}
          </For>
          <Show when={running()}>
            <div class="text-12-regular text-text-weak">working…</div>
          </Show>
        </div>
      </div>

      <div class="shrink-0 border-t border-border-weaker-base p-3">
        <input
          ref={fileInputEl}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          class="hidden"
          onChange={(event) => {
            void addImages(event.currentTarget.files ?? [])
            event.currentTarget.value = ""
          }}
        />
        <div
          class="flex flex-col gap-2 rounded-lg border border-border-weaker-base px-3 py-2 focus-within:border-border-strong-base"
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file")) event.preventDefault()
          }}
          onDrop={(event) => {
            const files = event.dataTransfer?.files
            if (!files?.length) return
            event.preventDefault()
            void addImages(files)
          }}
        >
          <Show when={attachmentState.images.length > 0}>
            <div class="flex gap-2 overflow-x-auto pb-0.5">
              <For each={attachmentState.images}>
                {(image) => (
                  <div class="group relative h-16 w-20 shrink-0 overflow-hidden rounded-md border border-border-weaker-base bg-background-stronger-base">
                    <img src={image.preview} alt={image.name} title={image.name} class="size-full object-cover" />
                    <div class="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-0.5 text-[10px] text-white">
                      {image.name}
                    </div>
                    <button
                      type="button"
                      class="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                      title={language.t("prompt.attachment.remove")}
                      aria-label={language.t("prompt.attachment.remove")}
                      onClick={() => removeImage(image.id)}
                    >
                      <Icon name="xmark-small" class="size-3.5" />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={queued().length > 0}>
            <div class="flex flex-col gap-1 px-1 pb-1">
              <For each={queued()}>
                {(text, index) => (
                  <div class="flex items-center gap-2 text-11-regular text-text-weak">
                    <span class="shrink-0 rounded border border-border-weaker-base px-1">queued</span>
                    <span class="min-w-0 flex-1 truncate">{text}</span>
                    <button
                      type="button"
                      class="shrink-0 rounded p-0.5 hover:text-text-base"
                      title="Remove from the queue"
                      aria-label="Remove from the queue"
                      onClick={() => unqueue(index())}
                    >
                      <Icon name="xmark-small" class="size-3.5" />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="flex items-end gap-2" data-tour="composer">
            <textarea
              ref={inputEl}
              rows={2}
              class="max-h-40 flex-1 resize-none bg-transparent text-14-regular text-text-base outline-none placeholder:text-text-weak"
              placeholder={placeholder(composer())}
              disabled={!inputEnabled(composer())}
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onPaste={(event) => {
                const images = Array.from(event.clipboardData?.files ?? []).filter((file) => !!fileMime(file))
                if (images.length === 0) return
                event.preventDefault()
                void addImages(images)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
                // Esc interrupts, matching opencode's prompt.
                if (event.key === "Escape" && running()) {
                  event.preventDefault()
                  void api?.stop()
                }
              }}
            />
            {/* Attach sits with Send, bottom-right: the two things you do to a
                message you have finished writing belong together. */}
            <button
              type="button"
              class="shrink-0 rounded p-1 text-text-weak hover:bg-background-stronger-base hover:text-text-base disabled:opacity-40"
              disabled={!available() || attachmentState.images.length >= IMAGE_LIMIT}
              onClick={() => fileInputEl?.click()}
              title={language.t("prompt.menu.imagesAndFiles")}
              aria-label={language.t("prompt.menu.imagesAndFiles")}
            >
              <PaperclipIcon class="size-4" />
            </button>
            {/* One button, exactly as in opencode's own composer: Stop while a
                turn runs and there is nothing to send, Send otherwise. */}
            <button
              type="button"
              class="shrink-0 rounded p-1 text-text-weak hover:bg-background-stronger-base hover:text-text-base disabled:opacity-40"
              classList={{ "text-red-500 hover:text-red-400": composerAction(composer()) === "stop" }}
              disabled={!composerEnabled(composer())}
              onClick={() => (composerAction(composer()) === "stop" ? void api?.stop() : void send())}
              title={
                composerAction(composer()) === "stop"
                  ? language.t("prompt.action.stop")
                  : language.t("prompt.action.send")
              }
              aria-label={
                composerAction(composer()) === "stop"
                  ? language.t("prompt.action.stop")
                  : language.t("prompt.action.send")
              }
            >
              <Show when={composerAction(composer()) === "stop"} fallback={<Icon name="arrow-up" class="size-4" />}>
                <StopIcon class="size-4" />
              </Show>
            </button>
          </div>
          <Show when={attachmentState.error}>
            {(error) => <div class="px-1 text-11-regular text-red-500">{error()}</div>}
          </Show>
        </div>
      </div>
    </div>
  )
}
