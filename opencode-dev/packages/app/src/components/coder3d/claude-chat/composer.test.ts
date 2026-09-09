import { describe, expect, test } from "bun:test"
import { composerAction, composerEnabled, inputEnabled, placeholder, takeQueued, queueFor } from "./composer"

const state = (patch: Partial<Parameters<typeof composerAction>[0]> = {}) => ({
  running: false,
  blank: true,
  available: true,
  ...patch,
})

describe("composer action", () => {
  test("idle and empty: send, but disabled", () => {
    expect(composerAction(state())).toBe("send")
    expect(composerEnabled(state())).toBe(false)
  })

  test("idle with text: send, enabled", () => {
    expect(composerAction(state({ blank: false }))).toBe("send")
    expect(composerEnabled(state({ blank: false }))).toBe(true)
  })

  test("running and empty: the same button becomes stop", () => {
    // This is opencode's rule (prompt-input.tsx: stopping = working && blank),
    // and it is why the composer never needs a second button.
    expect(composerAction(state({ running: true }))).toBe("stop")
    expect(composerEnabled(state({ running: true }))).toBe(true)
  })

  test("running with text: back to send, so the next turn can be queued", () => {
    expect(composerAction(state({ running: true, blank: false }))).toBe("send")
    expect(composerEnabled(state({ running: true, blank: false }))).toBe(true)
  })

  test("no CLI: nothing is actionable", () => {
    expect(composerEnabled(state({ available: false, blank: false }))).toBe(false)
    expect(composerEnabled(state({ available: false, running: true }))).toBe(false)
  })
})

describe("input", () => {
  test("a running turn must not lock the box — that was the bug", () => {
    expect(inputEnabled(state({ running: true }))).toBe(true)
  })

  test("only a missing CLI disables typing", () => {
    expect(inputEnabled(state({ available: false }))).toBe(false)
  })

  test("placeholder invites the next message instead of naming a button", () => {
    expect(placeholder(state({ running: true }))).toBe("Type the next message — it will be sent when this turn ends…")
    expect(placeholder(state())).toBe("Ask the agent to design something…")
    // The box must name whoever is actually selected.
    expect(placeholder({ ...state(), agent: "Codex" })).toBe("Ask Codex to design something…")
    expect(placeholder({ ...state(), agent: "Claude" })).toBe("Ask Claude to design something…")
  })
})

describe("queue", () => {
  test("messages typed during a turn are held per conversation, in order", () => {
    const queue = new Map<string, { dir: string; text: string; images: { name: string }[] }[]>()
    queueFor(queue, "ses_a", { dir: "C:/ws", text: "first", images: [] })
    queueFor(queue, "ses_a", { dir: "C:/ws", text: "second", images: [] })
    queueFor(queue, "ses_b", { dir: "C:/ws", text: "elsewhere", images: [] })

    expect(takeQueued(queue, "ses_a")?.text).toBe("first")
    expect(takeQueued(queue, "ses_a")?.text).toBe("second")
    expect(takeQueued(queue, "ses_a")).toBeUndefined()
    expect(takeQueued(queue, "ses_b")?.text).toBe("elsewhere")
  })

  test("draining a conversation with nothing queued is not an error", () => {
    expect(takeQueued(new Map(), "C:/ws")).toBeUndefined()
  })
})
