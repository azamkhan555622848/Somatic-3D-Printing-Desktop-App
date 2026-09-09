// History lookup: the session id in <workspace>/.coder3d/claude-session.json
// points at Claude Code's own transcript under ~/.claude/projects. The projects
// root is injectable so these tests never touch the real home directory.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claudeChatHistory, readChatSession, writeChatSession } from "./claude-chat"

const LEGACY = "legacy-thread-id"

const roots: string[] = []
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "coder3d-history-"))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const SESSION = "4862c91b-6f8e-4950-b7b8-0788a58b7ad1"
const LINE = JSON.stringify({ type: "user", message: { role: "user", content: "continue with the knee brace" } })

function makeWorkspace(root: string, sessionId = SESSION) {
  const dir = join(root, "ws")
  mkdirSync(join(dir, ".coder3d"), { recursive: true })
  writeFileSync(join(dir, ".coder3d", "claude-session.json"), JSON.stringify({ sessionId }), "utf-8")
  return dir
}

describe("per-session conversations", () => {
  test("two sessions in one workspace keep separate conversations", () => {
    // The whole point: the sidebar lists sessions, so each must be its own
    // conversation. Keyed by workspace alone, "New session" handed back the
    // previous chat.
    const root = makeRoot()
    const dir = join(root, "ws")
    mkdirSync(dir, { recursive: true })
    writeChatSession(dir, "claude", "ses_aaa", "claude-thread-1")
    writeChatSession(dir, "claude", "ses_bbb", "claude-thread-2")
    expect(readChatSession(dir, "claude", "ses_aaa")).toBe("claude-thread-1")
    expect(readChatSession(dir, "claude", "ses_bbb")).toBe("claude-thread-2")
  })

  test("each agent keeps its own thread inside one session", () => {
    const root = makeRoot()
    const dir = join(root, "ws")
    mkdirSync(dir, { recursive: true })
    writeChatSession(dir, "claude", "ses_aaa", "claude-thread")
    writeChatSession(dir, "codex", "ses_aaa", "codex-thread")
    expect(readChatSession(dir, "claude", "ses_aaa")).toBe("claude-thread")
    expect(readChatSession(dir, "codex", "ses_aaa")).toBe("codex-thread")
  })

  test("an unknown session simply has no conversation yet", () => {
    const root = makeRoot()
    const dir = join(root, "ws")
    mkdirSync(dir, { recursive: true })
    expect(readChatSession(dir, "claude", "ses_new")).toBeUndefined()
  })

  test("the pre-session conversation is adopted once, not orphaned", () => {
    // Before this change every workspace had a single claude-session.json.
    // The first session to open inherits that thread so a long-running
    // conversation survives the upgrade; the legacy file is then set aside so
    // a second session does not inherit the same thread twice.
    const root = makeRoot()
    const dir = join(root, "ws")
    mkdirSync(join(dir, ".coder3d"), { recursive: true })
    writeFileSync(join(dir, ".coder3d", "claude-session.json"), JSON.stringify({ sessionId: LEGACY }), "utf-8")

    expect(readChatSession(dir, "claude", "ses_first")).toBe(LEGACY)
    // Adopted: it is now that session's own thread...
    expect(readChatSession(dir, "claude", "ses_first")).toBe(LEGACY)
    // ...and nobody else's.
    expect(readChatSession(dir, "claude", "ses_second")).toBeUndefined()
    expect(existsSync(join(dir, ".coder3d", "claude-session.json"))).toBe(false)
  })

  test("adoption is per agent - a codex legacy file does not feed claude", () => {
    const root = makeRoot()
    const dir = join(root, "ws")
    mkdirSync(join(dir, ".coder3d"), { recursive: true })
    writeFileSync(join(dir, ".coder3d", "codex-session.json"), JSON.stringify({ sessionId: LEGACY }), "utf-8")
    expect(readChatSession(dir, "claude", "ses_first")).toBeUndefined()
    expect(readChatSession(dir, "codex", "ses_first")).toBe(LEGACY)
  })
})

describe("claudeChatHistory", () => {
  test("finds the transcript under the munged workspace path", () => {
    const root = makeRoot()
    const projects = join(root, "projects")
    const dir = makeWorkspace(root)
    // Claude Code names the folder by replacing every non-alphanumeric
    // character of the cwd with "-" (C:\ws -> C--ws).
    const munged = dir.replace(/[^A-Za-z0-9]/g, "-")
    mkdirSync(join(projects, munged), { recursive: true })
    writeFileSync(join(projects, munged, `${SESSION}.jsonl`), `${LINE}\n`, "utf-8")

    expect(claudeChatHistory(dir, "ses_x", projects)).toEqual([
      { type: "user-message", text: "continue with the knee brace", images: [] },
    ])
  })

  test("falls back to scanning for the session id if the munging rule drifts", () => {
    const root = makeRoot()
    const projects = join(root, "projects")
    const dir = makeWorkspace(root)
    mkdirSync(join(projects, "some-other-encoding"), { recursive: true })
    writeFileSync(join(projects, "some-other-encoding", `${SESSION}.jsonl`), `${LINE}\n`, "utf-8")

    expect(claudeChatHistory(dir, "ses_x", projects)).toHaveLength(1)
  })

  test("no session, no transcript, or no projects dir all mean an empty replay", () => {
    const root = makeRoot()
    const bare = join(root, "bare-ws")
    mkdirSync(bare, { recursive: true })
    expect(claudeChatHistory(bare, "ses_x", join(root, "projects"))).toEqual([]) // no session file
    const dir = makeWorkspace(root)
    expect(claudeChatHistory(dir, "ses_x", join(root, "missing"))).toEqual([]) // no projects dir
    mkdirSync(join(root, "projects"), { recursive: true })
    expect(claudeChatHistory(dir, "ses_x", join(root, "projects"))).toEqual([]) // session file but no transcript
  })
})
