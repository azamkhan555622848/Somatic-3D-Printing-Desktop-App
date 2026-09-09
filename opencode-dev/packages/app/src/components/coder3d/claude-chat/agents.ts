// Which agent runs a turn, and on which model. Both options are locally
// installed, locally authenticated CLIs billed to the operator's own
// subscription — Claude Code and Codex. No API keys, no token extraction.
//
// Kept out of the view so the choice can be tested: an agent/model pair goes
// straight to spawn(), so a bad pair is worth rejecting here rather than in a
// child process.

export type AgentId = "claude" | "codex"

export type AgentModel = { id: string; label: string }

export type AgentDef = {
  id: AgentId
  label: string
  /** The product name to use in prose — the CLI that owns the conversation
   *  history, which is not always the same word as the picker label. */
  product: string
  /** What the operator must have installed and signed into. */
  requirement: string
  models: readonly AgentModel[]
  /** Claude exposes a reasoning-effort flag; Codex takes it from its config. */
  efforts?: readonly string[]
}

export const AGENTS: readonly AgentDef[] = [
  {
    id: "claude",
    label: "Claude",
    product: "Claude Code",
    requirement: "Claude Code, signed in",
    // Aliases straight out of `claude --help`.
    models: [
      { id: "opus", label: "Opus 5" },
      { id: "fable", label: "Fable 5.1" },
      { id: "sonnet", label: "Sonnet 5" },
    ],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "codex",
    label: "Codex",
    product: "Codex",
    requirement: "Codex CLI, signed in with ChatGPT",
    // Which models Codex will actually accept depends on the signed-in plan,
    // not on what the binary knows: a ChatGPT account rejects gpt-5.6,
    // gpt-5.6-pro and gpt-5.1-codex-max with "not supported when using Codex
    // with a ChatGPT account", so offering them only produces failed turns.
    // The empty id means "whatever ~/.codex/config.toml selected", which is
    // the entry guaranteed to work for whoever is signed in.
    models: [
      { id: "", label: "Default (Codex config)" },
      { id: "gpt-6-astra", label: "gpt-6-astra" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
    ],
  },
]

const STORAGE_KEY = "coder3d-agent-choice"

export type AgentChoice = { agent: AgentId; model: string; effort: string }

export const DEFAULT_CHOICE: AgentChoice = { agent: "claude", model: "opus", effort: "high" }

export function agentDef(agent: AgentId): AgentDef {
  return AGENTS.find((def) => def.id === agent) ?? AGENTS[0]
}

export function agentLabel(agent: AgentId): string {
  return agentDef(agent).label
}

/** The model's friendly name, or the slug itself when it is not one of ours —
 *  a blank header would be worse than an unfamiliar string. */
export function modelLabel(agent: AgentId, model: string): string {
  const known = agentDef(agent).models.find((m) => m.id === model)
  return known?.label ?? (model || agentDef(agent).models[0].label)
}

export function readChoice(store: Pick<Storage, "getItem"> = localStorage): AgentChoice {
  let raw: string | null = null
  try {
    raw = store.getItem(STORAGE_KEY)
  } catch {
    return { ...DEFAULT_CHOICE }
  }
  if (!raw) return { ...DEFAULT_CHOICE }
  let parsed: Partial<AgentChoice>
  try {
    parsed = JSON.parse(raw) as Partial<AgentChoice>
  } catch {
    return { ...DEFAULT_CHOICE }
  }
  const agent: AgentId = parsed.agent === "codex" ? "codex" : "claude"
  const def = agentDef(agent)
  // A model belonging to the other agent would be handed to the wrong CLI.
  const model = def.models.some((m) => m.id === parsed.model) ? parsed.model! : def.models[0].id
  const effort = def.efforts?.includes(parsed.effort ?? "") ? parsed.effort! : DEFAULT_CHOICE.effort
  return { agent, model, effort }
}

export function storeChoice(choice: AgentChoice, store: Pick<Storage, "setItem"> = localStorage): void {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(choice))
  } catch {
    // Private mode or blocked storage: the choice just does not persist.
  }
}
