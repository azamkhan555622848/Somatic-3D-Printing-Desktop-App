import { describe, expect, test } from "bun:test"
import { AGENTS, agentLabel, modelLabel, readChoice, storeChoice, type AgentChoice } from "./agents"

describe("AGENTS", () => {
  test("both subscriptions are offered, each with its own models", () => {
    // Claude Code and Codex are both locally authenticated CLIs on the
    // operator's own subscription — neither ships an API key.
    expect(AGENTS.map((a) => a.id)).toEqual(["claude", "codex"])
    expect(AGENTS[0].models.map((m) => m.id)).toEqual(["opus", "fable", "sonnet"])
    expect(AGENTS[1].models.length).toBeGreaterThan(1)
  })

  test("Codex leads with the model its own config already selected", () => {
    // That one is guaranteed to work for whoever is signed in; a hardcoded
    // slug breaks the day OpenAI retires it.
    expect(AGENTS[1].models[0].id).toBe("")
    expect(AGENTS[1].models[0].label.toLowerCase()).toContain("default")
  })

  test("only models verified against a ChatGPT account are offered", () => {
    // Each was run through `codex exec --model <slug>` on this login and
    // answered; the rejected ones are pinned out by the test below.
    expect(AGENTS[1].models.map((m) => m.id)).toEqual(["", "gpt-6-astra", "gpt-5.6-sol"])
  })

  test("models a ChatGPT account rejects are not offered", () => {
    // Verified live on codex-cli 0.153.4: these return 400 "not supported when
    // using Codex with a ChatGPT account". Listing them only buys failed turns.
    const offered = AGENTS[1].models.map((m) => m.id)
    for (const rejected of ["gpt-5.6", "gpt-5.6-pro", "gpt-5.1-codex-max"]) {
      expect(offered).not.toContain(rejected)
    }
  })

  test("only Claude exposes effort levels", () => {
    expect(AGENTS[0].efforts).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(AGENTS[1].efforts).toBeUndefined()
  })
})

describe("product names", () => {
  test("each agent names the CLI that owns its history", () => {
    // The resumed-conversation notice used to say "Claude Code" even on Codex.
    expect(AGENTS[0].product).toBe("Claude Code")
    expect(AGENTS[1].product).toBe("Codex")
  })
})

describe("labels", () => {
  test("the header reads as agent plus model, not raw slugs", () => {
    expect(agentLabel("claude")).toBe("Claude")
    expect(agentLabel("codex")).toBe("Codex")
    expect(modelLabel("claude", "fable")).toBe("Fable 5.1")
    expect(modelLabel("codex", "gpt-6-astra")).toBe("gpt-6-astra")
  })

  test("an unknown model still renders as itself rather than blank", () => {
    expect(modelLabel("claude", "claude-fable-5")).toBe("claude-fable-5")
  })
})

describe("readChoice", () => {
  const store = (value: string | null) => ({ getItem: () => value }) as unknown as Storage

  test("a fresh install starts on Claude Opus at high effort", () => {
    expect(readChoice(store(null))).toEqual({ agent: "claude", model: "opus", effort: "high" })
  })

  test("a stored choice round-trips", () => {
    const saved: AgentChoice = { agent: "codex", model: "gpt-6-astra", effort: "high" }
    expect(readChoice(store(JSON.stringify(saved)))).toEqual(saved)
  })

  test("corrupt or hostile storage falls back instead of throwing", () => {
    expect(readChoice(store("{not json"))).toEqual({ agent: "claude", model: "opus", effort: "high" })
    // An unknown agent would be sent straight to spawn(); refuse it.
    expect(readChoice(store(JSON.stringify({ agent: "evil", model: "x" }))).agent).toBe("claude")
  })

  test("a model that does not belong to the agent is dropped", () => {
    // Selecting Codex then Opus would ask codex for a Claude model.
    const mixed = readChoice(store(JSON.stringify({ agent: "codex", model: "opus", effort: "high" })))
    expect(mixed.model).toBe("")
  })
})

describe("storeChoice", () => {
  test("writes what readChoice can read back", () => {
    let written = ""
    const store = { setItem: (_k: string, v: string) => (written = v) } as unknown as Storage
    storeChoice({ agent: "claude", model: "fable", effort: "max" }, store)
    expect(readChoice({ getItem: () => written } as unknown as Storage)).toEqual({
      agent: "claude",
      model: "fable",
      effort: "max",
    })
  })
})
