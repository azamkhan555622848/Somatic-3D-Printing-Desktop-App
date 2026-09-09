import { describe, expect, test } from "bun:test"
import { CODEX_DEFAULT_MODEL, buildCodexArgs, parseCodexAuth, parseCodexLine } from "./codex-chat-protocol"

// Fixture lines recorded from codex-cli 0.153.4 (`codex exec --json`), trimmed
// to the fields we read. Codex emits JSONL events, not Claude's stream-json.
const THREAD = `{"type":"thread.started","thread_id":"01a0861b-4efe-7590-ac27-9d079f1b4581"}`
const TURN_STARTED = `{"type":"turn.started"}`
const MESSAGE = `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"codex probe ok"}}`
const CMD_STARTED = `{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"powershell -Command 'echo hello'","aggregated_output":"","exit_code":null,"status":"in_progress"}}`
const CMD_DONE = `{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"powershell -Command 'echo hello'","aggregated_output":"hello\\r\\n","exit_code":0,"status":"completed"}}`
const CMD_FAILED = `{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"false","aggregated_output":"boom","exit_code":1,"status":"completed"}}`
const TURN_DONE = `{"type":"turn.completed","usage":{"input_tokens":17318,"output_tokens":8}}`

describe("parseCodexLine", () => {
  test("thread.started carries the id a later turn resumes from", () => {
    expect(parseCodexLine(THREAD)).toEqual({
      type: "init",
      sessionId: "01a0861b-4efe-7590-ac27-9d079f1b4581",
      model: "",
    })
  })

  test("an agent message renders as assistant text", () => {
    expect(parseCodexLine(MESSAGE)).toEqual({
      type: "assistant-text",
      messageId: "item_0",
      text: "codex probe ok",
    })
  })

  test("a command becomes a Bash tool row so it renders like every other shell call", () => {
    // Reusing the name "Bash" is deliberate: toolDisplay already turns that
    // into a "Shell" row with the command as its subtitle, so a Codex turn
    // reads exactly like a Claude turn.
    expect(parseCodexLine(CMD_STARTED)).toEqual({
      type: "tool-start",
      id: "item_1",
      name: "Bash",
      input: { command: "powershell -Command 'echo hello'" },
    })
  })

  test("a finished command resolves its row with the captured output", () => {
    expect(parseCodexLine(CMD_DONE)).toEqual({
      type: "tool-result",
      id: "item_1",
      isError: false,
      output: "hello\r\n",
    })
  })

  test("a non-zero exit marks the row failed", () => {
    expect(parseCodexLine(CMD_FAILED)).toMatchObject({ type: "tool-result", id: "item_2", isError: true })
  })

  test("turn.completed ends the turn", () => {
    expect(parseCodexLine(TURN_DONE)).toMatchObject({ type: "result", ok: true })
  })

  test("noise and malformed lines are ignored", () => {
    expect(parseCodexLine(TURN_STARTED)).toBe(null)
    expect(parseCodexLine("not json")).toBe(null)
    expect(parseCodexLine(`{"type":"something.new"}`)).toBe(null)
  })

  test("an unknown item type still shows up as a row rather than vanishing", () => {
    // Codex gains item types over time; a silently dropped tool call would
    // leave the transcript claiming the agent did nothing.
    const line = `{"type":"item.completed","item":{"id":"item_9","type":"file_change","status":"completed"}}`
    expect(parseCodexLine(line)).toMatchObject({ type: "tool-result", id: "item_9", isError: false })
  })
})

describe("buildCodexArgs", () => {
  test("runs headless with JSONL events and write access to the workspace", () => {
    const args = buildCodexArgs({ model: "gpt-6-astra" })
    expect(args[0]).toBe("exec")
    expect(args).toContain("--json")
    // The agent edits case files, so it needs write access. Expressed as a
    // config override because `--sandbox` does not exist on `exec resume`,
    // and one arg shape for both paths is what keeps them from drifting.
    expect(args).toContain(`sandbox_mode="workspace-write"`)
    expect(args[args.indexOf(`sandbox_mode="workspace-write"`) - 1]).toBe("-c")
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-6-astra")
    // A case folder is not a git repo, and Codex refuses to run outside one.
    expect(args).toContain("--skip-git-repo-check")
    expect(args).not.toContain("resume")
  })

  test("every option precedes the positionals", () => {
    // `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`: an option after a
    // positional is rejected outright ("unexpected argument '--sandbox'").
    const args = buildCodexArgs({ model: "gpt-6-astra", resume: "01a0861b" })
    const firstPositional = args.indexOf("01a0861b")
    const lastOption = Math.max(...args.map((a, i) => (a.startsWith("-") && a !== "-" ? i : -1)))
    expect(lastOption).toBeLessThan(firstPositional)
  })

  test("resume never passes flags its subcommand does not define", () => {
    // `codex exec resume --help` lists neither --sandbox nor -C.
    const args = buildCodexArgs({ model: CODEX_DEFAULT_MODEL, resume: "01a0861b" })
    expect(args).not.toContain("--sandbox")
    expect(args).not.toContain("-C")
    expect(args.slice(0, 2)).toEqual(["exec", "resume"])
    expect(args.slice(-2)).toEqual(["01a0861b", "-"])
  })

  test("the default model is left to Codex's own config", () => {
    // Whatever the operator signed in with already works; hardcoding a slug
    // here would break the day OpenAI retires it.
    expect(buildCodexArgs({ model: CODEX_DEFAULT_MODEL })).not.toContain("--model")
  })

  test("the prompt is read from stdin, never argv", () => {
    // Same reason as the Claude backend: a cmd shim truncates argv at a
    // newline, and prompts are multi-line. "-" is always last.
    expect(buildCodexArgs({ model: CODEX_DEFAULT_MODEL }).at(-1)).toBe("-")
    expect(buildCodexArgs({ model: CODEX_DEFAULT_MODEL, resume: "t1" }).at(-1)).toBe("-")
  })
})

describe("parseCodexAuth", () => {
  // `codex login status` on codex-cli 0.153.4.
  test("a ChatGPT subscription login counts as signed in", () => {
    expect(parseCodexAuth("Logged in using ChatGPT", 0)).toBe(true)
  })

  test("a non-zero exit is signed out whatever it printed", () => {
    expect(parseCodexAuth("Logged in using ChatGPT", 1)).toBe(false)
  })

  test("no login produces false rather than a crash", () => {
    expect(parseCodexAuth("Not logged in", 0)).toBe(false)
    expect(parseCodexAuth("", 0)).toBe(false)
  })
})
