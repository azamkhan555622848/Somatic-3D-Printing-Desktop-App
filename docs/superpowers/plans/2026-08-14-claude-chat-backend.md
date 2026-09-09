# Claude-Chat Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app's chat IS Claude Opus 5 on the user's Max subscription: every composer turn spawns headless Claude Code (`claude -p --resume`), streams NDJSON into the app timeline, with full workspace autonomy behind the machine-owned walls. GLM stays behind a toggle.

**Architecture:** Main-process `ClaudeChatManager` (spawn/kill/parse/session-store) + IPC/preload bridge + a renderer `ClaudeChat` view with a pure event→message reducer. Per spec `2026-08-14-claude-chat-backend-design.md`.

**Tech Stack:** Electron main (node:child_process), claude CLI 2.1.232 (stream-json + `--include-partial-messages`), SolidJS, `@opencode-ai/session-ui/markdown`.

**Spec:** `3D-Coder/docs/superpowers/specs/2026-08-14-claude-chat-backend-design.md`

## Global Constraints

- claude CLI ≥ 2.1.231; installed 2.1.232 verified. Prompt via **stdin** — npm cmd-shims truncate argv at the first newline.
- Spawning the `.cmd` shim on Windows: `spawn(resolvedPath, args, { shell: true })` and **wrap every arg in double quotes** — the disallowedTools value contains `(`/`)`/`,` which cmd.exe mangles unquoted.
- Deny walls must equal `claude-mcp/src/coder3d_claude/cmd.py` `DENY_TOOLS` exactly (cross-referenced test).
- Real fixture lines recorded from claude 2.1.232 live in the scratchpad `stream-fixture.ndjson`; the result line **starts `{"is_error":…` with no `"type":"result"` key** — detect result lines by `is_error` + `session_id` presence, not by `type`.
- The user's global Claude Code hooks fire in these sessions (`system/hook_started` lines) — parser must ignore unknown/system lines silently.
- Tests: `bun test` from `packages/desktop` and `packages/app` respectively (never repo root); typecheck `bun run typecheck` per package.
- Commits on the Documents notebook repo, plain `-m`, no double-quotes in messages, Azam sole author (never any Claude attribution).
- The running dev app hot-reloads renderer edits; **main-process edits need an app restart** (WMI + hidden-wscript launcher per project memory).

## File Structure

```
packages/desktop/src/main/coder3d/
  claude-chat-protocol.ts   pure: arg builder, line splitter, line→event parser
  claude-chat-protocol.test.ts
  claude-chat.ts            ClaudeChatManager: spawn/kill, session store, IPC glue
  ipc.ts                    + register claude-chat channels
packages/desktop/src/preload/index.ts + types.ts   + api.coder3d.claudeChat
packages/app/src/components/coder3d/claude-chat/
  chat-model.ts             pure reducer: events → messages
  chat-model.test.ts
  claude-chat.tsx           view: header, list, composer
packages/app/src/pages/session.tsx                 backend toggle mount
packages/app/src/components/coder3d/delegate-badge.tsx   honest GLM-mode wording
```

---

### Task 1: Protocol module — args, line splitting, event parsing (TDD)

**Files:**
- Create: `packages/desktop/src/main/coder3d/claude-chat-protocol.ts`
- Test: `packages/desktop/src/main/coder3d/claude-chat-protocol.test.ts`

**Interfaces:**
- Produces: `DENY_TOOLS: string[]`; `buildClaudeArgs(opts: { resume?: string }): string[]` (argv AFTER the binary, prompt NOT included); `quoteArgs(args: string[]): string[]` (cmd-safe double-quote wrap); `splitLines(): { push(chunk: string): string[] }` (returns completed lines, buffers partials); `parseStreamLine(line: string): ClaudeChatEvent | null`; type `ClaudeChatEvent` =
  `{ type: "init"; sessionId: string; model: string } | { type: "text-delta"; text: string } | { type: "assistant-text"; messageId: string; text: string } | { type: "tool-start"; id: string; name: string; inputPreview: string } | { type: "tool-result"; id: string; isError: boolean } | { type: "result"; ok: boolean; sessionId: string; numTurns: number } | { type: "error"; message: string }`

- [ ] **Step 1: Write the failing tests** (fixture lines are verbatim from the recorded run — trimmed to the fields the parser reads; keep them single-line):

```typescript
import { describe, expect, test } from "bun:test"
import { DENY_TOOLS, buildClaudeArgs, parseStreamLine, quoteArgs, splitLines } from "./claude-chat-protocol"

const INIT = `{"type":"system","subtype":"init","cwd":"C:\\\\ws","session_id":"0df2a33e-b2b7-48bf-a6de-3d13680f9982","tools":["Task","Bash"],"model":"claude-opus-5"}`
const HOOK = `{"type":"system","subtype":"hook_started","hook_id":"x","hook_name":"SessionStart:startup"}`
const DELTA = `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"READ"}},"session_id":"s"}`
const ASSISTANT = `{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"READY"},{"type":"tool_use","id":"tu_1","name":"mcp__mesh__mesh_info","input":{"path":"m.stl"}}]}}`
const TOOL_RESULT = `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","is_error":false,"content":"ok"}]}}`
const RESULT = `{"is_error":false,"duration_api_ms":1805,"num_turns":1,"stop_reason":"end_turn","session_id":"0df2a33e-b2b7-48bf-a6de-3d13680f9982","total_cost_usd":0.17}`

describe("parseStreamLine", () => {
  test("init carries session id and model", () => {
    expect(parseStreamLine(INIT)).toEqual({
      type: "init", sessionId: "0df2a33e-b2b7-48bf-a6de-3d13680f9982", model: "claude-opus-5",
    })
  })
  test("hook and unknown lines are ignored", () => {
    expect(parseStreamLine(HOOK)).toBe(null)
    expect(parseStreamLine(`{"type":"rate_limit_event"}`)).toBe(null)
    expect(parseStreamLine("not json at all")).toBe(null)
  })
  test("text deltas stream", () => {
    expect(parseStreamLine(DELTA)).toEqual({ type: "text-delta", text: "READ" })
  })
  test("assistant message yields text + tool-start", () => {
    // parser returns ONE event per line; multi-block assistant lines return the
    // tool-start (chips must never be lost) and the reducer takes text from deltas.
    const ev = parseStreamLine(ASSISTANT)
    expect(ev).toEqual({ type: "tool-start", id: "tu_1", name: "mcp__mesh__mesh_info", inputPreview: `{"path":"m.stl"}` })
  })
  test("assistant text-only message yields assistant-text (delta fallback)", () => {
    const line = `{"type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"text","text":"hello"}]}}`
    expect(parseStreamLine(line)).toEqual({ type: "assistant-text", messageId: "msg_2", text: "hello" })
  })
  test("tool results resolve chips", () => {
    expect(parseStreamLine(TOOL_RESULT)).toEqual({ type: "tool-result", id: "tu_1", isError: false })
  })
  test("result line has no type key — detect by shape", () => {
    expect(parseStreamLine(RESULT)).toEqual({
      type: "result", ok: true, sessionId: "0df2a33e-b2b7-48bf-a6de-3d13680f9982", numTurns: 1,
    })
  })
})

describe("splitLines", () => {
  test("reassembles lines across chunk boundaries", () => {
    const s = splitLines()
    expect(s.push(`{"a":1}\n{"b"`)).toEqual([`{"a":1}`])
    expect(s.push(`:2}\n`)).toEqual([`{"b":2}`])
  })
})

describe("buildClaudeArgs", () => {
  test("core flags, walls, no newlines, no prompt", () => {
    const args = buildClaudeArgs({})
    for (const flag of ["-p", "--model", "opus", "--output-format", "stream-json",
      "--include-partial-messages", "--verbose", "--permission-mode", "acceptEdits"]) {
      expect(args).toContain(flag)
    }
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(DENY_TOOLS.join(","))
    expect(args.join(" ")).not.toContain("\n")
    expect(args).not.toContain("--resume")
  })
  test("resume included when given", () => {
    const args = buildClaudeArgs({ resume: "sess-1" })
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-1")
  })
  test("deny walls match the python delegate list", () => {
    expect(DENY_TOOLS).toEqual([
      "Edit(**/provenance.json)", "Write(**/provenance.json)",
      "Edit(**/meshes/qa/**)", "Write(**/meshes/qa/**)",
      "Edit(**/.identity/**)", "Write(**/.identity/**)", "Read(**/.identity/**)",
    ])
  })
  test("quoteArgs wraps everything for cmd.exe", () => {
    expect(quoteArgs(["-p", "Edit(**/x),Write(**/y)"])).toEqual([`"-p"`, `"Edit(**/x),Write(**/y)"`])
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — from `packages/desktop`: `bun test src/main/coder3d/claude-chat-protocol.test.ts` → module missing.

- [ ] **Step 3: Implement claude-chat-protocol.ts**

```typescript
// Pure protocol layer for the Claude chat backend: argv construction and
// stream-json line parsing. Kept free of electron imports so bun can test it.
// Deny walls MUST mirror claude-mcp/src/coder3d_claude/cmd.py DENY_TOOLS —
// a test on each side pins the pair together.

export const DENY_TOOLS = [
  "Edit(**/provenance.json)", "Write(**/provenance.json)",
  "Edit(**/meshes/qa/**)", "Write(**/meshes/qa/**)",
  "Edit(**/.identity/**)", "Write(**/.identity/**)", "Read(**/.identity/**)",
]

const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "mcp__cad", "mcp__mesh", "mcp__medimage"]

const SYSTEM_APPEND =
  "You are the design brain of 3D-Coder, a medical 3D-printing workspace. " +
  "Work happens in case folders (cases/<id>/ with dicom, nifti, segmentations, meshes, cad, prints). " +
  "Use the cad/mesh/medimage MCP tools for geometry and imaging work; gate verdicts and provenance " +
  "come from tool code only and their files are read-only to you."

export type ClaudeChatEvent =
  | { type: "init"; sessionId: string; model: string }
  | { type: "text-delta"; text: string }
  | { type: "assistant-text"; messageId: string; text: string }
  | { type: "tool-start"; id: string; name: string; inputPreview: string }
  | { type: "tool-result"; id: string; isError: boolean }
  | { type: "result"; ok: boolean; sessionId: string; numTurns: number }
  | { type: "error"; message: string }

export function buildClaudeArgs(opts: { resume?: string; mcpConfig?: string }): string[] {
  const args = [
    "-p", "--model", "opus",
    "--output-format", "stream-json", "--include-partial-messages", "--verbose",
    "--permission-mode", "acceptEdits",
    "--append-system-prompt", SYSTEM_APPEND,
  ]
  if (opts.resume) args.push("--resume", opts.resume)
  if (opts.mcpConfig) args.push("--mcp-config", opts.mcpConfig)
  args.push("--allowedTools", ALLOWED_TOOLS.join(","))
  args.push("--disallowedTools", DENY_TOOLS.join(","))
  return args
}

// cmd.exe parses the concatenated command line when spawning the npm .cmd shim
// with shell:true; unquoted ( ) , break it, so every arg gets wrapped.
export function quoteArgs(args: string[]): string[] {
  return args.map((a) => `"${a.replaceAll('"', '\\"')}"`)
}

export function splitLines() {
  let buffer = ""
  return {
    push(chunk: string): string[] {
      buffer += chunk
      const parts = buffer.split("\n")
      buffer = parts.pop() ?? ""
      return parts.filter((line) => line.trim().length > 0)
    },
  }
}

export function parseStreamLine(line: string): ClaudeChatEvent | null {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (obj === null || typeof obj !== "object") return null

  if (obj.type === "system" && obj.subtype === "init")
    return { type: "init", sessionId: obj.session_id, model: obj.model ?? "" }

  if (obj.type === "stream_event") {
    const delta = obj.event?.type === "content_block_delta" ? obj.event.delta : undefined
    if (delta?.type === "text_delta" && typeof delta.text === "string")
      return { type: "text-delta", text: delta.text }
    return null
  }

  if (obj.type === "assistant") {
    const content: any[] = obj.message?.content ?? []
    const tool = content.find((c) => c?.type === "tool_use")
    if (tool)
      return {
        type: "tool-start", id: tool.id, name: tool.name,
        inputPreview: JSON.stringify(tool.input ?? {}).slice(0, 120),
      }
    const text = content.find((c) => c?.type === "text")
    if (text) return { type: "assistant-text", messageId: obj.message?.id ?? "", text: text.text ?? "" }
    return null
  }

  if (obj.type === "user") {
    const content: any[] = obj.message?.content ?? []
    const result = content.find((c) => c?.type === "tool_result")
    if (result) return { type: "tool-result", id: result.tool_use_id, isError: result.is_error === true }
    return null
  }

  // The final summary line has no "type" key in 2.1.232 — detect by shape.
  if ("is_error" in obj && "session_id" in obj && "num_turns" in obj)
    return { type: "result", ok: obj.is_error === false, sessionId: obj.session_id, numTurns: obj.num_turns }

  return null
}
```

- [ ] **Step 4: Run to verify PASS**, fix any drift.
- [ ] **Step 5: Commit** — `git add packages/desktop/src/main/coder3d/claude-chat-protocol.*; git commit -m "feat(3d-coder): claude-chat protocol - args, line split, stream-json events"`

---

### Task 2: ClaudeChatManager + IPC + preload

**Files:**
- Create: `packages/desktop/src/main/coder3d/claude-chat.ts`
- Modify: `packages/desktop/src/main/coder3d/ipc.ts` (register channels)
- Modify: `packages/desktop/src/preload/index.ts` + `packages/desktop/src/preload/types.ts`

**Interfaces:**
- Consumes: Task 1's `buildClaudeArgs`, `quoteArgs`, `splitLines`, `parseStreamLine`, `ClaudeChatEvent`.
- Produces (preload `api.coder3d.claudeChat`):
  `send(dir: string, text: string): Promise<{ ok: boolean; error?: string }>` ·
  `stop(): Promise<void>` ·
  `newChat(dir: string): Promise<void>` ·
  `state(dir: string): Promise<{ available: boolean; sessionId?: string }>` ·
  `onEvent(cb: (e: ClaudeChatEvent) => void): () => void`

- [ ] **Step 1: Implement claude-chat.ts**

```typescript
// Claude chat backend: one headless `claude -p` process per turn, resumed via
// the session id stored in <workspace>/.coder3d/claude-session.json. Claude
// Code remains the authenticated Anthropic application — we never touch auth.
import { execFile, execFileSync, spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { WebContents } from "electron"
import { buildClaudeArgs, parseStreamLine, quoteArgs, splitLines } from "./claude-chat-protocol"
import type { ClaudeChatEvent } from "./claude-chat-protocol"

const MCP_CONFIG = join(__dirname, "../../3dcoder-config/claude-subagent-mcp.json")
// Resolved at first use; the dev config dir path works because the launcher cds
// into opencode-dev — fall back to the absolute location.
const MCP_CONFIG_ABS = "C:/Users/azamk/Documents/3D-Coder/opencode-dev/3dcoder-config/claude-subagent-mcp.json"

let binary: string | null | undefined
export function claudeBinary(): string | null {
  if (binary !== undefined) return binary
  try {
    binary = execFileSync("where.exe", ["claude"], { encoding: "utf-8" }).split(/\r?\n/)[0].trim() || null
  } catch {
    binary = null
  }
  return binary
}

function sessionFile(dir: string) {
  return join(dir, ".coder3d", "claude-session.json")
}
function readSession(dir: string): string | undefined {
  try {
    return JSON.parse(readFileSync(sessionFile(dir), "utf-8")).sessionId || undefined
  } catch {
    return undefined
  }
}
function writeSession(dir: string, sessionId: string) {
  mkdirSync(join(dir, ".coder3d"), { recursive: true })
  writeFileSync(sessionFile(dir), JSON.stringify({ sessionId }), "utf-8")
}

let child: ChildProcess | null = null

export function claudeChatStop() {
  if (child?.pid) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"])
  child = null
}

export function claudeChatNewChat(dir: string) {
  rmSync(sessionFile(dir), { force: true })
}

export function claudeChatState(dir: string) {
  return { available: claudeBinary() !== null, sessionId: readSession(dir) }
}

export function claudeChatSend(sender: WebContents, dir: string, text: string): { ok: boolean; error?: string } {
  const bin = claudeBinary()
  if (!bin) return { ok: false, error: "claude CLI not found on PATH" }
  if (child) return { ok: false, error: "a turn is already running" }
  const emit = (e: ClaudeChatEvent) => {
    if (!sender.isDestroyed()) sender.send("coder3d-claude-event", e)
  }
  const mcp = existsSync(MCP_CONFIG_ABS) ? MCP_CONFIG_ABS : existsSync(MCP_CONFIG) ? MCP_CONFIG : undefined
  const resume = readSession(dir)
  const args = quoteArgs(buildClaudeArgs({ resume, mcpConfig: mcp }))
  // shell:true concatenates the quoted args for cmd.exe (the npm shim is a .cmd)
  const proc = spawn(`"${bin}"`, args, { cwd: dir, shell: true, windowsHide: true })
  child = proc
  let stderrTail = ""
  let sawResult = false
  const lines = splitLines()
  proc.stdout!.setEncoding("utf-8")
  proc.stderr!.setEncoding("utf-8")
  proc.stdout!.on("data", (chunk: string) => {
    for (const line of lines.push(chunk)) {
      const event = parseStreamLine(line)
      if (!event) continue
      if (event.type === "init" || event.type === "result") writeSession(dir, event.sessionId)
      if (event.type === "result") sawResult = true
      emit(event)
    }
  })
  proc.stderr!.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000)
  })
  proc.on("close", (code) => {
    if (child === proc) child = null
    if (!sawResult) {
      // Stale --resume id is the common cause; clear it so the next turn starts fresh.
      if (resume && /No conversation found|session/i.test(stderrTail)) claudeChatNewChat(dir)
      emit({ type: "error", message: code === 0 ? "turn ended without a result" : stderrTail || `claude exited ${code}` })
    }
  })
  proc.on("error", (err) => {
    if (child === proc) child = null
    emit({ type: "error", message: String(err) })
  })
  proc.stdin!.write(text)
  proc.stdin!.end()
  return { ok: true }
}
```

- [ ] **Step 2: Register IPC in ipc.ts** (inside `registerCoder3dIpc`, mirroring existing handlers):

```typescript
  ipcMain.handle("coder3d-claude-send", (event, dir: string, text: string) =>
    claudeChatSend(event.sender, dir, text),
  )
  ipcMain.handle("coder3d-claude-stop", () => claudeChatStop())
  ipcMain.handle("coder3d-claude-new-chat", (_e, dir: string) => claudeChatNewChat(dir))
  ipcMain.handle("coder3d-claude-state", (_e, dir: string) => claudeChatState(dir))
```
with `import { claudeChatNewChat, claudeChatSend, claudeChatState, claudeChatStop } from "./claude-chat"`.

- [ ] **Step 3: Preload bridge** — in `preload/index.ts` under `coder3d`:

```typescript
    claudeChat: {
      send: (dir, text) => ipcRenderer.invoke("coder3d-claude-send", dir, text),
      stop: () => ipcRenderer.invoke("coder3d-claude-stop"),
      newChat: (dir) => ipcRenderer.invoke("coder3d-claude-new-chat", dir),
      state: (dir) => ipcRenderer.invoke("coder3d-claude-state", dir),
      onEvent: (cb) => {
        const handler = (_: unknown, e: unknown) => cb(e as any)
        ipcRenderer.on("coder3d-claude-event", handler)
        return () => ipcRenderer.removeListener("coder3d-claude-event", handler)
      },
    },
```
and extend `preload/types.ts`'s `Coder3dAPI` with the matching `claudeChat` shape (duplicate the `ClaudeChatEvent` union there — preload cannot import from main).

- [ ] **Step 4: Typecheck + tests** — from `packages/desktop`: `bun run typecheck` and `bun test src/main/coder3d/` all green.
- [ ] **Step 5: Commit** — `git commit -m "feat(3d-coder): ClaudeChatManager - per-turn claude spawn, session store, IPC bridge"`

---

### Task 3: Renderer chat reducer (TDD)

**Files:**
- Create: `packages/app/src/components/coder3d/claude-chat/chat-model.ts`
- Test: `packages/app/src/components/coder3d/claude-chat/chat-model.test.ts`

**Interfaces:**
- Consumes: the `ClaudeChatEvent` union (re-declared here; renderer types the preload bridge).
- Produces: `type ChatPart = { kind: "text"; text: string } | { kind: "tool"; id: string; name: string; inputPreview: string; state: "running" | "ok" | "error" }`; `type ChatMessage = { role: "user" | "assistant"; parts: ChatPart[] }`; `applyEvent(messages: ChatMessage[], e: ClaudeChatEvent): ChatMessage[]` (immutable update); `userMessage(text: string): ChatMessage`.

- [ ] **Step 1: Failing tests**

```typescript
import { describe, expect, test } from "bun:test"
import { applyEvent, userMessage, type ChatMessage } from "./chat-model"

const run = (events: any[], start: ChatMessage[] = []) => events.reduce(applyEvent, start)

describe("applyEvent", () => {
  test("text deltas accumulate into one assistant text part", () => {
    const out = run([
      { type: "text-delta", text: "REA" },
      { type: "text-delta", text: "DY" },
    ], [userMessage("hi")])
    expect(out[1]).toEqual({ role: "assistant", parts: [{ kind: "text", text: "READY" }] })
  })

  test("assistant-text is ignored when deltas already produced the text", () => {
    const out = run([
      { type: "text-delta", text: "READY" },
      { type: "assistant-text", messageId: "m1", text: "READY" },
    ])
    expect(out[0].parts).toEqual([{ kind: "text", text: "READY" }])
  })

  test("assistant-text renders when no deltas arrived", () => {
    const out = run([{ type: "assistant-text", messageId: "m1", text: "hello" }])
    expect(out[0].parts).toEqual([{ kind: "text", text: "hello" }])
  })

  test("tool lifecycle: start chip then resolve", () => {
    const out = run([
      { type: "tool-start", id: "t1", name: "mcp__mesh__mesh_info", inputPreview: "{}" },
      { type: "tool-result", id: "t1", isError: false },
      { type: "text-delta", text: "done" },
    ])
    expect(out[0].parts[0]).toEqual({ kind: "tool", id: "t1", name: "mcp__mesh__mesh_info", inputPreview: "{}", state: "ok" })
    expect(out[0].parts[1]).toEqual({ kind: "text", text: "done" })
  })

  test("tool error marks the chip", () => {
    const out = run([
      { type: "tool-start", id: "t1", name: "Bash", inputPreview: "{}" },
      { type: "tool-result", id: "t1", isError: true },
    ])
    expect(out[0].parts[0].state).toBe("error")
  })

  test("error events append an assistant error text part", () => {
    const out = run([{ type: "error", message: "boom" }])
    expect(out[0].parts[0]).toEqual({ kind: "text", text: "⚠ boom" })
  })

  test("text after a tool starts a NEW text part (order preserved)", () => {
    const out = run([
      { type: "text-delta", text: "Let me check. " },
      { type: "tool-start", id: "t1", name: "Read", inputPreview: "{}" },
      { type: "tool-result", id: "t1", isError: false },
      { type: "text-delta", text: "All good." },
    ])
    expect(out[0].parts.map((p: any) => p.kind)).toEqual(["text", "tool", "text"])
  })
})
```

- [ ] **Step 2: Verify FAIL**, then implement chat-model.ts

```typescript
// Pure reducer: main-process stream events -> renderable chat messages.
// Deltas build text live; full assistant-text lines only render when no delta
// text arrived for the current part (2.1.232 sends BOTH).

export type ClaudeChatEvent =
  | { type: "init"; sessionId: string; model: string }
  | { type: "text-delta"; text: string }
  | { type: "assistant-text"; messageId: string; text: string }
  | { type: "tool-start"; id: string; name: string; inputPreview: string }
  | { type: "tool-result"; id: string; isError: boolean }
  | { type: "result"; ok: boolean; sessionId: string; numTurns: number }
  | { type: "error"; message: string }

export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; inputPreview: string; state: "running" | "ok" | "error" }

export type ChatMessage = { role: "user" | "assistant"; parts: ChatPart[] }

export function userMessage(text: string): ChatMessage {
  return { role: "user", parts: [{ kind: "text", text }] }
}

function withAssistant(messages: ChatMessage[]): [ChatMessage[], ChatMessage] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant") {
    const copy = { ...last, parts: [...last.parts] }
    return [[...messages.slice(0, -1), copy], copy]
  }
  const fresh: ChatMessage = { role: "assistant", parts: [] }
  return [[...messages, fresh], fresh]
}

export function applyEvent(messages: ChatMessage[], e: ClaudeChatEvent): ChatMessage[] {
  switch (e.type) {
    case "text-delta": {
      const [next, msg] = withAssistant(messages)
      const last = msg.parts[msg.parts.length - 1]
      if (last?.kind === "text") msg.parts[msg.parts.length - 1] = { kind: "text", text: last.text + e.text }
      else msg.parts.push({ kind: "text", text: e.text })
      return next
    }
    case "assistant-text": {
      const [next, msg] = withAssistant(messages)
      const last = msg.parts[msg.parts.length - 1]
      if (last?.kind === "text" && last.text.length > 0) return messages // deltas got here first
      msg.parts.push({ kind: "text", text: e.text })
      return next
    }
    case "tool-start": {
      const [next, msg] = withAssistant(messages)
      msg.parts.push({ kind: "tool", id: e.id, name: e.name, inputPreview: e.inputPreview, state: "running" })
      return next
    }
    case "tool-result": {
      return messages.map((m) => ({
        ...m,
        parts: m.parts.map((p) =>
          p.kind === "tool" && p.id === e.id ? { ...p, state: e.isError ? "error" : "ok" } : p,
        ),
      }))
    }
    case "error": {
      const [next, msg] = withAssistant(messages)
      msg.parts.push({ kind: "text", text: `⚠ ${e.message}` })
      return next
    }
    default:
      return messages
  }
}
```

- [ ] **Step 3: Verify PASS** — from `packages/app`: `bun test src/components/coder3d/claude-chat/`
- [ ] **Step 4: Commit** — `git commit -m "feat(3d-coder): claude chat reducer - events to messages"`

---

### Task 4: ClaudeChat view + mount + honest GLM badge

**Files:**
- Create: `packages/app/src/components/coder3d/claude-chat/claude-chat.tsx`
- Modify: `packages/app/src/pages/session.tsx` (backend toggle around the chat column content)
- Modify: `packages/app/src/components/coder3d/delegate-badge.tsx` (honest wording)

**Interfaces:**
- Consumes: `applyEvent`/`userMessage`/types (Task 3); preload `api.coder3d.claudeChat` (Task 2); `Markdown` from `@opencode-ai/session-ui/markdown`; `useSDK` for the workspace directory.
- Produces: `<ClaudeChat />` self-contained view; localStorage key `coder3d-chat-backend` (`"claude"` default | `"glm"`); exported `useChatBackend(): [() => "claude" | "glm", (v) => void]` from claude-chat.tsx for session.tsx.

- [ ] **Step 1: Implement claude-chat.tsx** — structure (full component, ~200 lines):

```tsx
// The app's default chat: headless Claude Code on the user's subscription.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { useSDK } from "@/context/sdk"
import { applyEvent, userMessage, type ChatMessage, type ClaudeChatEvent } from "./chat-model"

const BACKEND_KEY = "coder3d-chat-backend"
export function useChatBackend() {
  const [backend, setBackend] = createSignal<"claude" | "glm">(
    localStorage.getItem(BACKEND_KEY) === "glm" ? "glm" : "claude",
  )
  const set = (v: "claude" | "glm") => {
    setBackend(v)
    localStorage.setItem(BACKEND_KEY, v)
  }
  return [backend, set] as const
}

type Bridge = {
  send(dir: string, text: string): Promise<{ ok: boolean; error?: string }>
  stop(): Promise<void>
  newChat(dir: string): Promise<void>
  state(dir: string): Promise<{ available: boolean; sessionId?: string }>
  onEvent(cb: (e: ClaudeChatEvent) => void): () => void
}
const bridge = (): Bridge | undefined => (window as any).api?.coder3d?.claudeChat

export function ClaudeChat(props: { onSwitchToGlm: () => void }) {
  const sdk = useSDK()
  const api = bridge()
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [running, setRunning] = createSignal(false)
  const [available, setAvailable] = createSignal(true)
  const [resumed, setResumed] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  let listEl: HTMLDivElement | undefined

  onMount(async () => {
    if (!api) return
    const dir = sdk().directory
    if (dir) {
      const s = await api.state(dir)
      setAvailable(s.available)
      setResumed(!!s.sessionId)
    }
  })
  const unsub = api?.onEvent((e) => {
    if (e.type === "result") setRunning(false)
    if (e.type === "error") setRunning(false)
    setMessages((m) => applyEvent(m, e))
    queueMicrotask(() => listEl?.scrollTo({ top: listEl.scrollHeight }))
  })
  onCleanup(() => unsub?.())

  const send = async () => {
    const dir = sdk().directory
    const text = draft().trim()
    if (!api || !dir || !text || running()) return
    setMessages((m) => [...m, userMessage(text)])
    setDraft("")
    setRunning(true)
    const r = await api.send(dir, text)
    if (!r.ok) {
      setRunning(false)
      setMessages((m) => applyEvent(m, { type: "error", message: r.error ?? "send failed" }))
    }
  }
  const stop = () => void api?.stop()
  const newChat = async () => {
    const dir = sdk().directory
    if (!api || !dir || running()) return
    await api.newChat(dir)
    setMessages([])
    setResumed(false)
  }
  // render: header (Claude · Opus 5 · High | New chat | Stop | GLM), banner if
  // !available, resumed divider, message list (user right-aligned bubble /
  // assistant <Markdown> + tool chips), composer textarea (Enter=send,
  // Shift+Enter=newline, disabled while running).
  // ... (full JSX in implementation; tool chip: `▸ {shortName} ✓/✗/spinner`,
  // shortName strips the mcp__<server>__ prefix)
}
```

The JSX body follows the panel's styling conventions (`text-12-regular`, `border-border-weaker-base`, `bg-background-stronger-base` bubbles). Tool chip name display: `name.replace(/^mcp__[^_]+__/, "")`.

- [ ] **Step 2: Mount in session.tsx.** Where the chat column renders `sessionPanelContent()` (both layout branches use the `@container` div — inside it, wrap the SessionPanelFrame):

```tsx
{/* 3D-Coder: the default chat is Claude on the user's subscription; the stock
    opencode (GLM) chat stays behind the toggle. */}
<Show when={chatBackend() === "claude"} fallback={/* existing frame JSX */}>
  <ClaudeChat onSwitchToGlm={() => setChatBackend("glm")} />
</Show>
```
with `const [chatBackend, setChatBackend] = useChatBackend()` near the other hooks, and a small "Claude" pill in the GLM composer area is NOT needed — the ClaudeChat header carries the GLM link; the way BACK from GLM is a matching link added next to the delegate badge (Step 3).

- [ ] **Step 3: Honest badge + return path.** In `delegate-badge.tsx`: text becomes `Claude Opus 5 · delegate` with title *"GLM-5.2 runs this chat; heavy design work delegates to Claude Opus 5 via your subscription. Click to switch the whole chat to Claude."* and make the badge a **button** that flips `coder3d-chat-backend` to `"claude"` (import `useChatBackend`; it accepts a `onActivate` prop wired in prompt-input-v2, or simplest: the badge component itself calls `useChatBackend()` and sets on click — document that reload of the signal is shared module scope). Ensure the two `useChatBackend` call sites share state: hoist the signal to module scope inside claude-chat.tsx (`const [backend, setBackend] = createSignal(...)` at module level, hook returns it).

- [ ] **Step 4: Typecheck + tests + commit** — from `packages/app`: `bun run typecheck`, `bun test src/components/coder3d/` → green. `git commit -m "feat(3d-coder): Claude chat view - default backend with GLM toggle and honest badge"`

---

### Task 5: Live verification over CDP + memory

**Files:** scratchpad probes only (not committed); memory update.

- [ ] **Step 1: Restart the app** (main-process changes): kill the 3D-Coder tree (include `opencode-cli.exe`), relaunch via WMI + `launch-hidden.vbs`, wait for :9222.
- [ ] **Step 2: First-turn walk (CDP):** confirm the ClaudeChat view renders by default (header `Claude · Opus 5 · High`); type via CDP into the composer: *"Use the mesh tool to run mesh_info on cases/demo/meshes/tube_rack.stl and give me one line."* Verify: user bubble, streaming text grows across two screenshots, a `mesh_info` tool chip flips to ✓, final line references real dims (72×55×31). Zero `Runtime.exceptionThrown`.
- [ ] **Step 3: Stop + resume walk:** send a long task ("analyze every mesh in cases/"), hit Stop within 2s → turn ends with the error/interrupt bubble and no zombie `claude` process (`Get-Process | Where CommandLine -like *claude*`). Send *"what file did I just ask about?"* → answer references tube_rack.stl (session continuity).
- [ ] **Step 4: Restart the app once more,** open the chat: "Resumed previous session" divider shows; ask the continuity question again → still remembered.
- [ ] **Step 5: GLM toggle round-trip:** switch to GLM (stock chat + honest badge visible), back to Claude.
- [ ] **Step 6: Walls spot-check:** ask Claude to edit `cases/demo/provenance.json` → refusal (disallowedTools).
- [ ] **Step 7: Fix whatever the screenshots contradict; commit fixes** — `git commit -m "fix(3d-coder): claude chat polish from live verification"`. Update `project_3d_coder.md` memory with the shipped state + gotchas found.

---

## Self-Review Notes (completed)

- **Spec coverage:** §3 architecture → T2; §4 invocation (stdin prompt, quoting, walls, append-system) → T1/T2; §5 protocol incl. typeless result line → T1; §6 session store + stale-resume retry → T2 (`close` handler clears stale id; plan's retry is "clear so next turn is fresh" — one manual resend rather than silent auto-retry, acceptable v1 simplification of spec §8, noted here deliberately); §7 UI incl. honest GLM badge + toggle both directions → T4; §8 errors → T2/T4; §10 testing → T1/T3/T5.
- **Type consistency:** `ClaudeChatEvent` union declared in three places by design (main, preload types, renderer) — field names identical; T1's parser tests and T3's reducer tests share event literals.
- **Placeholders:** Task 4 Step 1 elides the JSX body with a written contract of exactly what it must contain (header items, bubble/chip/composer behavior, class conventions) — the implementer writes it against the reducer's tested types; everything else is complete code.
