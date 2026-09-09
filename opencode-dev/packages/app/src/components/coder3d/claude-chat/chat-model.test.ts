import { describe, expect, test } from "bun:test"
import { applyEvent, toolDisplay, userMessage, type ChatMessage, type ClaudeChatEvent } from "./chat-model"

const toolPart = (name: string, input: Record<string, unknown>, output = "") =>
  ({ kind: "tool", id: "t", name, input, output, state: "ok" }) as const

const run = (events: ClaudeChatEvent[], start: ChatMessage[] = []) => events.reduce(applyEvent, start)

describe("applyEvent", () => {
  test("user messages retain image previews with optional text", () => {
    expect(userMessage("", [{ name: "scan.png", src: "data:image/png;base64,eA==" }])).toEqual({
      role: "user",
      parts: [{ kind: "image", name: "scan.png", src: "data:image/png;base64,eA==" }],
    })
    expect(userMessage("Inspect", [{ name: "scan.png", src: "preview" }]).parts.map((part) => part.kind)).toEqual([
      "text",
      "image",
    ])
  })

  test("text deltas accumulate into one assistant text part", () => {
    const out = run(
      [
        { type: "text-delta", text: "REA" },
        { type: "text-delta", text: "DY" },
      ],
      [userMessage("hi")],
    )
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
      { type: "tool-start", id: "t1", name: "mcp__mesh__mesh_info", input: {} },
      { type: "tool-result", id: "t1", isError: false, output: "" },
      { type: "text-delta", text: "done" },
    ])
    expect(out[0].parts[0]).toEqual({
      kind: "tool",
      id: "t1",
      name: "mcp__mesh__mesh_info",
      input: {},
      output: "",
      state: "ok",
    })
    expect(out[0].parts[1]).toEqual({ kind: "text", text: "done" })
  })

  test("tool error marks the chip", () => {
    const out = run([
      { type: "tool-start", id: "t1", name: "Bash", input: {} },
      { type: "tool-result", id: "t1", isError: true, output: "boom" },
    ])
    const part = out[0].parts[0]
    expect(part.kind === "tool" && part.state).toBe("error")
  })

  test("error events append an assistant error text part", () => {
    const out = run([{ type: "error", message: "boom" }])
    expect(out[0].parts[0]).toEqual({ kind: "text", text: "⚠ boom" })
  })

  test("text after a tool starts a NEW text part (order preserved)", () => {
    const out = run([
      { type: "text-delta", text: "Let me check. " },
      { type: "tool-start", id: "t1", name: "Read", input: {} },
      { type: "tool-result", id: "t1", isError: false, output: "" },
      { type: "text-delta", text: "All good." },
    ])
    expect(out[0].parts.map((p) => p.kind)).toEqual(["text", "tool", "text"])
  })

  test("a user message starts a fresh assistant turn", () => {
    const first = run([{ type: "text-delta", text: "one" }])
    const out = run([{ type: "text-delta", text: "two" }], [...first, userMessage("again")])
    expect(out.map((m) => m.role)).toEqual(["assistant", "user", "assistant"])
    expect(out[2].parts).toEqual([{ kind: "text", text: "two" }])
  })

  test("tool output lands on the row when it resolves", () => {
    const out = run([
      { type: "tool-start", id: "t1", name: "Bash", input: { command: "ls" } },
      { type: "tool-result", id: "t1", isError: false, output: "a.txt\nb.txt" },
    ])
    const part = out[0].parts[0]
    expect(part.kind === "tool" && part.output).toBe("a.txt\nb.txt")
  })

  test("user-message events rebuild user bubbles on history replay", () => {
    // The live stream never carries user messages (the composer echoes them
    // itself); replaying Claude Code's session file has to reconstruct them.
    const out = run([
      { type: "user-message", text: "measure the cuff", images: [] },
      { type: "assistant-text", messageId: "m1", text: "It is 160mm." },
      { type: "user-message", text: "what do u see", images: [{ name: "scan.png", src: "data:image/png;base64,eA==" }] },
      { type: "assistant-text", messageId: "m2", text: "A knee CT." },
    ])
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"])
    expect(out[0]).toEqual(userMessage("measure the cuff"))
    expect(out[2].parts).toEqual([
      { kind: "text", text: "what do u see" },
      { kind: "image", name: "scan.png", src: "data:image/png;base64,eA==" },
    ])
    // The second assistant turn must not merge into the first.
    expect(out[3].parts).toEqual([{ kind: "text", text: "A knee CT." }])
  })

  test("init and result events do not change the transcript", () => {
    const before = run([{ type: "text-delta", text: "x" }])
    const after = run(
      [
        { type: "init", sessionId: "s", model: "claude-opus-5" },
        { type: "result", ok: true, sessionId: "s", numTurns: 1 },
      ],
      before,
    )
    expect(after).toEqual(before)
  })
})

describe("toolDisplay", () => {
  test("Bash shows the command and its output", () => {
    const d = toolDisplay(toolPart("Bash", { command: "python build.py\n--force" }, "built ok"))
    expect(d.title).toBe("Shell")
    expect(d.subtitle).toBe("python build.py") // first line only
    expect(d.body).toBe("built ok")
  })

  test("Read shows a short path plus range args", () => {
    const d = toolDisplay(
      toolPart("Read", {
        file_path: "C:/Users/x/Documents/3D-Coder/workspace/cases/demo/cad/rack.py",
        offset: 10,
        limit: 20,
      }),
    )
    expect(d.title).toBe("Read")
    expect(d.subtitle).toBe("cases/demo/cad/rack.py")
    expect(d.args).toEqual(["offset=10", "limit=20"])
  })

  test("Write reports added lines and shows the content", () => {
    const d = toolDisplay(toolPart("Write", { file_path: "cases/demo/cad/a.py", content: "one\ntwo\nthree" }))
    expect(d.changes).toEqual({ additions: 3, deletions: 0 })
    expect(d.body).toBe("one\ntwo\nthree")
  })

  test("Edit renders a diff body with both counts", () => {
    const d = toolDisplay(toolPart("Edit", { file_path: "a.py", old_string: "x = 1", new_string: "x = 2\ny = 3" }))
    expect(d.bodyKind).toBe("diff")
    expect(d.body).toBe("- x = 1\n+ x = 2\n+ y = 3")
    expect(d.changes).toEqual({ additions: 2, deletions: 1 })
  })

  test("MCP tools lead with the path-like argument", () => {
    const d = toolDisplay(
      toolPart("mcp__mesh__mesh_info", { path: "cases/demo/meshes/rack.stl", units: "mm" }, "watertight: true"),
    )
    expect(d.title).toBe("mesh_info")
    expect(d.subtitle).toBe("cases/demo/meshes/rack.stl")
    expect(d.args).toEqual(["units=mm"])
    expect(d.body).toBe("watertight: true")
  })

  test("unknown tools still show their call", () => {
    const d = toolDisplay(toolPart("SomethingNew", { alpha: 1 }))
    expect(d.title).toBe("SomethingNew")
    expect(d.body).toContain("alpha")
  })
})
