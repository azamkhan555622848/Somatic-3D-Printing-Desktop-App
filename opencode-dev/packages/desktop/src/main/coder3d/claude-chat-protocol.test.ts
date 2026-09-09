import { describe, expect, test } from "bun:test"
import {
  CLAUDE_EFFORTS,
  CLAUDE_IMAGE_LIMIT,
  CLAUDE_IMAGE_MAX_BYTES,
  CLAUDE_MODELS,
  DENY_TOOLS,
  buildClaudeArgs,
  buildClaudeInput,
  parseClaudeAuth,
  parseHistory,
  parseStreamLine,
  quoteArgs,
  splitLines,
  validateClaudeImages,
} from "./claude-chat-protocol"

// Fixture lines recorded from claude 2.1.232 (--output-format stream-json
// --include-partial-messages --verbose), trimmed to the fields we read.
const INIT = `{"type":"system","subtype":"init","cwd":"C:\\\\ws","session_id":"0df2a33e-b2b7-48bf-a6de-3d13680f9982","tools":["Task","Bash"],"model":"claude-opus-5"}`
const HOOK = `{"type":"system","subtype":"hook_started","hook_id":"x","hook_name":"SessionStart:startup"}`
const DELTA = `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"READ"}},"session_id":"s"}`
const ASSISTANT = `{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"READY"},{"type":"tool_use","id":"tu_1","name":"mcp__mesh__mesh_info","input":{"path":"m.stl"}}]}}`
const TOOL_RESULT = `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","is_error":false,"content":"ok"}]}}`
const RESULT = `{"is_error":false,"duration_api_ms":1805,"num_turns":1,"stop_reason":"end_turn","session_id":"0df2a33e-b2b7-48bf-a6de-3d13680f9982","total_cost_usd":0.17}`

describe("parseStreamLine", () => {
  test("init carries session id and model", () => {
    expect(parseStreamLine(INIT)).toEqual({
      type: "init",
      sessionId: "0df2a33e-b2b7-48bf-a6de-3d13680f9982",
      model: "claude-opus-5",
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

  test("assistant message yields tool-start with the full input", () => {
    // One event per line: the chip must never be lost, and the text already
    // arrived via deltas. The input rides along so the row can show arguments.
    expect(parseStreamLine(ASSISTANT)).toEqual({
      type: "tool-start",
      id: "tu_1",
      name: "mcp__mesh__mesh_info",
      input: { path: "m.stl" },
    })
  })

  test("assistant text-only message yields assistant-text (delta fallback)", () => {
    const line = `{"type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"text","text":"hello"}]}}`
    expect(parseStreamLine(line)).toEqual({ type: "assistant-text", messageId: "msg_2", text: "hello" })
  })

  test("tool results resolve rows and carry their output", () => {
    expect(parseStreamLine(TOOL_RESULT)).toEqual({
      type: "tool-result",
      id: "tu_1",
      isError: false,
      output: "ok",
    })
  })

  test("block-shaped tool result content is flattened to text", () => {
    const line = `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_2","is_error":false,"content":[{"type":"text","text":"line one"},{"type":"text","text":"line two"}]}]}}`
    expect(parseStreamLine(line)).toEqual({
      type: "tool-result",
      id: "tu_2",
      isError: false,
      output: "line one\nline two",
    })
  })

  test("result line has no type key - detect by shape", () => {
    expect(parseStreamLine(RESULT)).toEqual({
      type: "result",
      ok: true,
      sessionId: "0df2a33e-b2b7-48bf-a6de-3d13680f9982",
      numTurns: 1,
    })
  })
})

describe("parseClaudeAuth", () => {
  // `claude auth status` prints JSON. Recorded from claude 2.1.232.
  test("a signed-in CLI reports loggedIn", () => {
    const out = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" })
    expect(parseClaudeAuth(out)).toBe(true)
  })

  test("a signed-out CLI reports false, not a crash", () => {
    expect(parseClaudeAuth(JSON.stringify({ loggedIn: false }))).toBe(false)
  })

  test("unreadable output counts as signed out rather than blocking the user", () => {
    // Being wrong in this direction shows an extra sign-in hint; being wrong
    // the other way lets a turn fail mid-chat with a raw auth error.
    expect(parseClaudeAuth("")).toBe(false)
    expect(parseClaudeAuth("not json")).toBe(false)
    expect(parseClaudeAuth("null")).toBe(false)
  })
})

describe("splitLines", () => {
  test("reassembles lines across chunk boundaries", () => {
    const s = splitLines()
    expect(s.push(`{"a":1}\n{"b"`)).toEqual([`{"a":1}`])
    expect(s.push(`:2}\n`)).toEqual([`{"b":2}`])
  })

  test("blank lines are dropped", () => {
    const s = splitLines()
    expect(s.push('\n\n{"a":1}\n')).toEqual([`{"a":1}`])
  })
})

describe("buildClaudeArgs", () => {
  test("core flags, walls, no newlines, no prompt", () => {
    const args = buildClaudeArgs({})
    for (const flag of [
      "-p",
      "--model",
      "opus",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    ]) {
      expect(args).toContain(flag)
    }
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(DENY_TOOLS.join(","))
    expect(args.join(" ")).not.toContain("\n")
    expect(args).not.toContain("--resume")
  })

  test("research tools are allowed up front", () => {
    // A tool missing from --allowedTools cannot be granted later: `claude -p`
    // has no prompt to show, so the user saying "I approve" reaches nobody.
    const allowed = buildClaudeArgs({})[buildClaudeArgs({}).indexOf("--allowedTools") + 1].split(",")
    expect(allowed).toContain("WebSearch")
    expect(allowed).toContain("WebFetch")
    expect(allowed).toContain("mcp__print")
  })

  test("the system prompt tells the model it cannot ask for approvals", () => {
    const args = buildClaudeArgs({})
    const appended = args[args.indexOf("--append-system-prompt") + 1]
    expect(appended).toContain("non-interactive")
    expect(appended.toLowerCase()).toContain("never ask")
  })

  test("the model and effort are the caller's choice, not a hardcoded default", () => {
    // The header is a picker now; opus is only what it starts on.
    const args = buildClaudeArgs({ model: "fable", effort: "max" })
    expect(args[args.indexOf("--model") + 1]).toBe("fable")
    expect(args[args.indexOf("--effort") + 1]).toBe("max")
  })

  test("aliases match what the installed CLI documents", () => {
    // `claude --help`: "Provide an alias for the latest model (e.g. 'fable',
    // 'opus', or 'sonnet')" and effort "(low, medium, high, xhigh, max)".
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual(["opus", "fable", "sonnet"])
    expect(CLAUDE_EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  test("resume and mcp config included when given", () => {
    const args = buildClaudeArgs({ resume: "sess-1", mcpConfig: "C:/cfg.json" })
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-1")
    expect(args[args.indexOf("--mcp-config") + 1]).toBe("C:/cfg.json")
  })

  test("deny walls match the python delegate list", () => {
    expect(DENY_TOOLS).toEqual([
      "Edit(**/provenance.json)",
      "Write(**/provenance.json)",
      "Edit(**/meshes/qa/**)",
      "Write(**/meshes/qa/**)",
      "Edit(**/prints/qa/**)",
      "Write(**/prints/qa/**)",
      "Edit(**/.identity/**)",
      "Write(**/.identity/**)",
      "Read(**/.identity/**)",
    ])
  })

  test("quoteArgs wraps everything for cmd.exe", () => {
    expect(quoteArgs(["-p", "Edit(**/x),Write(**/y)"])).toEqual([`"-p"`, `"Edit(**/x),Write(**/y)"`])
  })
})

// History lines as Claude Code writes them to
// ~/.claude/projects/<munged-cwd>/<sessionId>.jsonl (recorded from 2.1.232).
const jsonl = (...objects: unknown[]) => objects.map((o) => JSON.stringify(o)).join("\n")
const hUser = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: "user",
  message: { role: "user", content },
  isSidechain: false,
  ...extra,
})
const hAssistant = (content: unknown[], id = "msg_h1") => ({
  type: "assistant",
  message: { id, role: "assistant", content },
  isSidechain: false,
})

describe("parseHistory", () => {
  test("a plain prompt (string content) becomes a user-message", () => {
    expect(parseHistory(jsonl(hUser("continue with the knee brace")))).toEqual([
      { type: "user-message", text: "continue with the knee brace", images: [] },
    ])
  })

  test("stream-json prompts (block content) keep text and rebuild image previews", () => {
    // buildClaudeInput writes [prompt, "Attached image: name", image] — the
    // marker names the image and must not render as user text.
    const line = hUser([
      { type: "text", text: "what do u see here" },
      { type: "text", text: "Attached image: scan.png" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
    ])
    expect(parseHistory(jsonl(line))).toEqual([
      {
        type: "user-message",
        text: "what do u see here",
        images: [{ name: "scan.png", src: "data:image/png;base64,aGVsbG8=" }],
      },
    ])
  })

  test("assistant lines replay as text and tool chips, thinking is dropped", () => {
    const events = parseHistory(
      jsonl(
        hAssistant([{ type: "thinking", thinking: "private" }]),
        hAssistant([{ type: "text", text: "Measuring the cuff." }]),
        hAssistant([{ type: "tool_use", id: "tu_9", name: "mcp__mesh__mesh_info", input: { path: "m.stl" } }]),
        hUser([{ type: "tool_result", tool_use_id: "tu_9", is_error: false, content: "160mm" }]),
      ),
    )
    expect(events).toEqual([
      { type: "assistant-text", messageId: "msg_h1", text: "Measuring the cuff." },
      { type: "tool-start", id: "tu_9", name: "mcp__mesh__mesh_info", input: { path: "m.stl" } },
      { type: "tool-result", id: "tu_9", isError: false, output: "160mm" },
    ])
  })

  test("consecutive assistant text lines coalesce into one event", () => {
    // applyEvent treats a second assistant-text as the delta-duplicate and
    // drops it — a replayed conversation must not lose paragraphs to that.
    const events = parseHistory(
      jsonl(hAssistant([{ type: "text", text: "First paragraph." }]), hAssistant([{ type: "text", text: "Second." }])),
    )
    expect(events).toEqual([{ type: "assistant-text", messageId: "msg_h1", text: "First paragraph.\n\nSecond." }])
  })

  test("injected context and subagent traffic are skipped", () => {
    const events = parseHistory(
      jsonl(
        hUser([{ type: "text", text: "Base directory for this skill: ..." }], { isMeta: true }),
        hUser("subagent prompt", { isSidechain: true }),
        { type: "queue-operation", operation: "enqueue" },
        { type: "mode", mode: "default" },
        { type: "attachment", attachment: {} },
        { type: "last-prompt", prompt: "x" },
        "not json at all",
        hUser("the real prompt"),
      ),
    )
    expect(events).toEqual([{ type: "user-message", text: "the real prompt", images: [] }])
  })

  test("tools left running at the end resolve as interrupted", () => {
    // A Stop or app quit kills the turn between tool-start and tool-result;
    // replaying that verbatim would show a spinner forever.
    const events = parseHistory(jsonl(hAssistant([{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }])))
    expect(events).toEqual([
      { type: "tool-start", id: "tu_1", name: "Bash", input: {} },
      { type: "tool-result", id: "tu_1", isError: true, output: "interrupted" },
    ])
  })

  test("history tool output is capped harder than the live stream", () => {
    const line = hUser([{ type: "tool_result", tool_use_id: "tu_2", is_error: false, content: "x".repeat(10_000) }])
    const [event] = parseHistory(jsonl(line))
    expect(event).toMatchObject({ type: "tool-result", id: "tu_2" })
    expect((event as { output: string }).output.length).toBe(8_000)
  })

  test("only the newest events survive the cap", () => {
    const lines = jsonl(...Array.from({ length: 5 }, (_, i) => hUser(`prompt ${i}`)))
    expect(parseHistory(lines, 2)).toEqual([
      { type: "user-message", text: "prompt 3", images: [] },
      { type: "user-message", text: "prompt 4", images: [] },
    ])
  })
})

describe("Claude multimodal input", () => {
  test("encodes text and images as one stream-json user event", () => {
    const line = buildClaudeInput("Inspect this", [{ name: "scan\nfront.png", mime: "image/png", data: "aGVsbG8=" }])
    expect(line.endsWith("\n")).toBe(true)
    expect(JSON.parse(line)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Inspect this" },
          { type: "text", text: "Attached image: scan front.png" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
          },
        ],
      },
      parent_tool_use_id: null,
    })
  })

  test("allows an image-only message", () => {
    const event = JSON.parse(buildClaudeInput("", [{ name: "photo.jpg", mime: "image/jpeg", data: "aGVsbG8=" }]))
    expect(event.message.content.map((part: { type: string }) => part.type)).toEqual(["text", "image"])
  })

  test("validates count, type, base64, and byte limits", () => {
    const image = { name: "a.png", mime: "image/png" as const, data: "aGVsbG8=" }
    expect(validateClaudeImages([image])).toBeUndefined()
    expect(validateClaudeImages(Array.from({ length: CLAUDE_IMAGE_LIMIT + 1 }, () => image))).toBe("too-many")
    expect(validateClaudeImages([{ ...image, mime: "image/svg+xml" }])).toBe("unsupported-type")
    expect(validateClaudeImages([{ ...image, data: "not base64!" }])).toBe("invalid-data")
    expect(validateClaudeImages([{ ...image, data: "a" }])).toBe("invalid-data")
    expect(
      validateClaudeImages([{ ...image, data: "a".repeat(Math.ceil((CLAUDE_IMAGE_MAX_BYTES * 4) / 3) + 5) }]),
    ).toBe("too-large")
    expect(validateClaudeImages([null])).toBe("invalid-data")
  })
})
