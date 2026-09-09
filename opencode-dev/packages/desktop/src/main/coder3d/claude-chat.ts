// Claude chat backend: one headless `claude -p` process per turn, resumed via
// the session id stored in <workspace>/.coder3d/claude-session.json.
//
// Compliance: this never touches Anthropic auth. It shells out to the locally
// installed, locally authenticated Claude Code CLI, so Claude Code itself
// remains the authenticated application and the turn bills to the user's own
// subscription. No OAuth tokens are extracted or proxied.
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { WebContents } from "electron"
import {
  buildClaudeArgs,
  buildClaudeInput,
  parseClaudeAuth,
  parseHistory,
  parseStreamLine,
  quoteArgs,
  splitLines,
  validateClaudeImages,
} from "./claude-chat-protocol"
import type { ClaudeChatEvent, ClaudeChatImage } from "./claude-chat-protocol"
import { CODEX_DEFAULT_MODEL, buildCodexArgs, parseCodexAuth, parseCodexLine } from "./codex-chat-protocol"

/** Which locally authenticated CLI runs the turn. Each stays the authenticated
 *  application for its own vendor; we only shell out to it. */
export type ChatAgent = "claude" | "codex"

const binaries = new Map<ChatAgent, string | null>()

export function agentBinary(agent: ChatAgent): string | null {
  const cached = binaries.get(agent)
  if (cached) return cached
  const finder = process.platform === "win32" ? "where.exe" : "which"
  let found: string | null = null
  try {
    const hits = execFileSync(finder, [agent], { encoding: "utf-8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    // where.exe lists every match; the .cmd shim is the one node can spawn.
    found = hits.find((p) => p.toLowerCase().endsWith(".cmd")) ?? hits[0] ?? null
  } catch {
    found = null
  }
  // Only a hit is remembered: a user who installs the CLI while Somatic is
  // open should not have to restart to be found.
  if (found) binaries.set(agent, found)
  return found
}

/** Installed is not the same as usable: a present binary that nobody has signed
 *  into fails at turn time with a raw auth error. Asking the CLI up front is
 *  what lets the UI say "sign in" instead of letting a chat turn die. */
export function agentSignedIn(agent: ChatAgent): boolean {
  const bin = agentBinary(agent)
  if (!bin) return false
  const win = process.platform === "win32"
  const args = agent === "codex" ? ["login", "status"] : ["auth", "status"]
  // spawnSync, not execFileSync: `codex login status` reports on stderr, and
  // execFileSync only hands back stdout — which read as "signed out" for an
  // account that was signed in the whole time.
  const run = spawnSync(win ? `"${bin}"` : bin, win ? quoteArgs(args) : args, {
    encoding: "utf-8",
    shell: win,
    windowsHide: true,
    timeout: 10_000,
  })
  if (run.error) return false
  const stdout = run.stdout ?? ""
  const stderr = run.stderr ?? ""
  if (agent === "codex") return parseCodexAuth(`${stdout}
${stderr}`, run.status ?? 1)
  return parseClaudeAuth(stdout)
}

export function claudeBinary(): string | null {
  return agentBinary("claude")
}

function mcpConfig(): string | undefined {
  const configured = process.env["CODER3D_CLAUDE_MCP_CONFIG"]
  return configured && existsSync(configured) ? configured : undefined
}

// One conversation per opencode session per agent. Keyed by session because
// that is what the sidebar lists: keyed by workspace alone, every session in a
// folder shared one chat and "New session" handed back the previous one.
function sessionFile(dir: string, agent: ChatAgent, chatKey: string) {
  // The key comes from a route parameter, so it never escapes .coder3d.
  const safe = chatKey.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "default"
  return join(dir, ".coder3d", "chats", safe, `${agent}.json`)
}

/** The single pre-session file this workspace used before conversations were
 *  split per session. */
function legacyFile(dir: string, agent: ChatAgent) {
  return join(dir, ".coder3d", `${agent}-session.json`)
}

function readIdFrom(file: string): string | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf-8")).sessionId || undefined
  } catch {
    return undefined
  }
}

export function writeChatSession(dir: string, agent: ChatAgent, chatKey: string, sessionId: string): void {
  if (!sessionId) return
  const target = sessionFile(dir, agent, chatKey)
  try {
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, JSON.stringify({ sessionId }), "utf-8")
  } catch {
    // A read-only or missing workspace just means no resume next time.
  }
}

export function readChatSession(dir: string, agent: ChatAgent, chatKey: string): string | undefined {
  const own = readIdFrom(sessionFile(dir, agent, chatKey))
  if (own) return own
  // Nothing yet for this session: inherit the workspace's pre-session
  // conversation once, so a long-running thread survives the upgrade instead
  // of being orphaned. Renamed rather than deleted, and renamed rather than
  // copied, so a second session cannot inherit the same thread twice.
  const legacy = legacyFile(dir, agent)
  const inherited = readIdFrom(legacy)
  if (!inherited) return undefined
  writeChatSession(dir, agent, chatKey, inherited)
  try {
    renameSync(legacy, `${legacy}.adopted`)
  } catch {
    // If it cannot be renamed it would be inherited again; drop it instead.
    rmSync(legacy, { force: true })
  }
  return inherited
}

// Claude Code's own transcript of the resumed session. The renderer replays it
// on startup so a restarted app shows the conversation, not a blank panel.
export function claudeChatHistory(
  dir: string,
  chatKey = "default",
  projectsRoot = join(homedir(), ".claude", "projects"),
) {
  const sessionId = readChatSession(dir, "claude", chatKey)
  if (!sessionId) return []
  // The per-project folder is the cwd with every non-alphanumeric character
  // replaced by "-". That rule is Claude Code's internal detail — if the
  // direct path misses, find the session by its (unique) id instead.
  const direct = join(projectsRoot, dir.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`)
  let file = existsSync(direct) ? direct : undefined
  if (!file) {
    try {
      for (const folder of readdirSync(projectsRoot)) {
        const candidate = join(projectsRoot, folder, `${sessionId}.jsonl`)
        if (existsSync(candidate)) {
          file = candidate
          break
        }
      }
    } catch {
      return []
    }
  }
  if (!file) return []
  try {
    return parseHistory(readFileSync(file, "utf-8"))
  } catch {
    return []
  }
}

let child: ChildProcess | null = null
let childDir: string | null = null
// Which session's turn is in flight, so a sibling session's composer is not
// told it is busy.
let childKey: string | null = null
// The window that should receive stream events. A turn outlives a renderer
// reload, and the WebContents captured when it started is then destroyed — so
// events are delivered to whoever is listening NOW, not to that stale handle.
let listener: WebContents | null = null

function emitEvent(event: ClaudeChatEvent) {
  if (listener && !listener.isDestroyed()) listener.send("coder3d-claude-event", event)
}

export function claudeChatStop() {
  const proc = child
  child = null
  childDir = null
  childKey = null
  if (!proc?.pid) return
  // The npm shim spawns node underneath, so kill the whole tree.
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => {})
  else proc.kill("SIGTERM")
}

export function claudeChatNewChat(dir: string, agent: ChatAgent = "claude", chatKey = "default") {
  rmSync(sessionFile(dir, agent, chatKey), { force: true })
}

/** Called on mount, which is also how a reloaded window re-attaches mid-turn.
 *  `agents` reports which CLIs are installed so the picker can grey out the
 *  ones this machine cannot run. */
export function claudeChatState(
  dir: string,
  sender?: WebContents,
  agent: ChatAgent = "claude",
  chatKey = "default",
) {
  if (sender) listener = sender
  return {
    available: agentBinary(agent) !== null,
    signedIn: agentSignedIn(agent),
    agents: { claude: agentBinary("claude") !== null, codex: agentBinary("codex") !== null },
    sessionId: readChatSession(dir, agent, chatKey),
    // A turn belongs to one session, so another session's composer stays idle.
    running: child !== null && childDir === dir && childKey === chatKey,
  }
}

export type SendOptions = { agent?: ChatAgent; model?: string; effort?: string; chatKey?: string }

export function claudeChatSend(
  sender: WebContents,
  dir: string,
  text: string,
  images: unknown = [],
  options: SendOptions = {},
): { ok: boolean; error?: string } {
  const agent: ChatAgent = options.agent === "codex" ? "codex" : "claude"
  const bin = agentBinary(agent)
  if (!bin)
    return {
      ok: false,
      error:
        agent === "codex"
          ? "codex CLI not found on PATH - install Codex and run `codex login`"
          : "claude CLI not found on PATH - install Claude Code and sign in",
    }
  if (child) return { ok: false, error: "a turn is already running" }
  if (typeof text !== "string" || !Array.isArray(images)) return { ok: false, error: "invalid message" }
  if (!text.trim() && images.length === 0) return { ok: false, error: "message is empty" }
  const imageError = validateClaudeImages(images)
  if (imageError) return { ok: false, error: `invalid image attachment: ${imageError}` }
  const imagePayloads = images as ClaudeChatImage[]
  // Codex takes images as files on disk (`-i FILE`), not inline base64, so
  // saying so beats silently dropping the attachment.
  if (agent === "codex" && imagePayloads.length > 0)
    return { ok: false, error: "image attachments are Claude-only for now - switch agent or send text" }

  listener = sender
  const emit = emitEvent

  const chatKey = options.chatKey || "default"
  const resume = readChatSession(dir, agent, chatKey)
  const args =
    agent === "codex"
      ? buildCodexArgs({ model: options.model ?? CODEX_DEFAULT_MODEL, resume })
      : buildClaudeArgs({ resume, mcpConfig: mcpConfig(), model: options.model, effort: options.effort })
  const parseLine = agent === "codex" ? parseCodexLine : parseStreamLine
  // On Windows the CLI is an npm .cmd shim: it needs a shell, and cmd.exe
  // reparses the line, so every argument is quoted (the deny list contains
  // parentheses and commas). Elsewhere spawn the binary directly.
  const win = process.platform === "win32"
  const proc = win
    ? spawn(`"${bin}"`, quoteArgs(args), { cwd: dir, shell: true, windowsHide: true })
    : spawn(bin, args, { cwd: dir })
  child = proc
  childDir = dir
  childKey = chatKey

  let stderrTail = ""
  let sawResult = false
  const lines = splitLines()

  proc.stdout!.setEncoding("utf-8")
  proc.stderr!.setEncoding("utf-8")

  proc.stdout!.on("data", (chunk: string) => {
    for (const line of lines.push(chunk)) {
      const event = parseLine(line)
      if (!event) continue
      if (event.type === "init" || event.type === "result")
        writeChatSession(dir, agent, chatKey, event.sessionId)
      if (event.type === "result") sawResult = true
      emit(event)
    }
  })

  proc.stderr!.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000)
  })

  proc.on("close", (code) => {
    const stopped = child !== proc // Stop() already cleared it
    if (!stopped) {
      child = null
      childDir = null
      childKey = null
    }
    if (sawResult) return
    if (stopped) {
      emit({ type: "error", message: "stopped" })
      return
    }
    // A stale session id is the usual cause; clear it so the next turn is fresh.
    if (resume && /no conversation|session|thread/i.test(stderrTail)) claudeChatNewChat(dir, agent, chatKey)
    emit({
      type: "error",
      message: stderrTail.trim() || (code === 0 ? "turn ended without a result" : `claude exited ${code}`),
    })
  })

  proc.on("error", (err) => {
    if (child === proc) {
      child = null
      childDir = null
      childKey = null
    }
    emit({ type: "error", message: String(err) })
  })

  // Stream-json input carries both text and real multimodal image blocks. The
  // prompt still rides stdin because npm cmd-shims truncate argv at newlines.
  // Codex reads a plain prompt from stdin (the "-" argument); Claude takes a
  // stream-json envelope that can also carry image blocks.
  proc.stdin!.write(agent === "codex" ? text : buildClaudeInput(text, imagePayloads))
  proc.stdin!.end()
  return { ok: true }
}
