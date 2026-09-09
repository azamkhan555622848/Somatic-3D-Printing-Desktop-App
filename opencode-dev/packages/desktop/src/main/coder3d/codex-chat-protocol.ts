// Pure protocol layer for the Codex chat backend: argv construction and JSONL
// parsing, mapped onto the SAME ClaudeChatEvent union the Claude backend
// emits. The renderer therefore needs no idea which agent produced a turn.
//
// Compliance mirrors claude-chat.ts: this shells out to the locally installed,
// locally authenticated Codex CLI (`codex login status` -> "Logged in using
// ChatGPT"), so Codex itself remains the authenticated application and the
// turn bills to the operator's own subscription. No tokens are extracted.
import type { ClaudeChatEvent } from "./claude-chat-protocol"

/** Sentinel: let Codex use whatever `~/.codex/config.toml` selected. That is
 *  the one model guaranteed to work for this operator, so it is the default
 *  and it never appears on the command line. */
export const CODEX_DEFAULT_MODEL = ""

// Verified against a ChatGPT-account login on codex-cli 0.153.4. The binary
// knows more slugs (gpt-5.6, gpt-5.6-pro, gpt-5.1-codex-max) but the account
// rejects them with "not supported when using Codex with a ChatGPT account",
// so they are not offered. The default above always works.
export const CODEX_MODELS = ["gpt-6-astra", "gpt-5.6-sol"] as const

// Tool output can be a whole file; cap it so one command cannot flood IPC.
const OUTPUT_CAP = 60_000

/** Argv for one turn. The working root is the spawned process's cwd, not a
 *  flag: `codex exec resume` defines neither `-C` nor `--sandbox`, and passing
 *  an option it does not know aborts the turn before it starts.
 *
 *  Order matters. Usage is `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`
 *  — an option written after a positional is rejected outright with
 *  "unexpected argument '--sandbox' found". */
export function buildCodexArgs(opts: { model: string; resume?: string }): string[] {
  const args = opts.resume ? ["exec", "resume"] : ["exec"]
  args.push("--json", "--skip-git-repo-check")
  // Write access as a config override rather than `--sandbox`, because that
  // flag exists only on plain `exec`. One shape for both paths is what stops
  // the resume path from silently drifting away from the fresh one.
  args.push("-c", `sandbox_mode="workspace-write"`)
  if (opts.model) args.push("--model", opts.model)
  // Positionals last: the thread to continue, then "-" for a prompt on stdin
  // (an npm .cmd shim truncates argv at a newline, so it never rides argv).
  if (opts.resume) args.push(opts.resume)
  args.push("-")
  return args
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.slice(0, OUTPUT_CAP) : ""
}

export function parseCodexLine(line: string): ClaudeChatEvent | null {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (obj === null || typeof obj !== "object") return null

  // The thread id is what a later turn resumes from — Codex's session_id.
  if (obj.type === "thread.started" && obj.thread_id)
    return { type: "init", sessionId: String(obj.thread_id), model: "" }

  if (obj.type === "turn.completed") return { type: "result", ok: true, sessionId: "", numTurns: 1 }
  if (obj.type === "turn.failed")
    return { type: "error", message: textOf(obj.error?.message) || "the turn failed" }

  if (obj.type === "item.started" || obj.type === "item.completed") {
    const item = obj.item
    if (!item || typeof item !== "object" || !item.id) return null
    const done = obj.type === "item.completed"

    if (item.type === "agent_message") {
      // Only on completion: the started event carries no text yet.
      return done ? { type: "assistant-text", messageId: String(item.id), text: textOf(item.text) } : null
    }

    if (item.type === "command_execution") {
      if (!done)
        return {
          type: "tool-start",
          id: String(item.id),
          // "Bash" so toolDisplay renders it as a Shell row with the command
          // as subtitle, exactly like a Claude shell call.
          name: "Bash",
          input: { command: textOf(item.command) },
        }
      return {
        type: "tool-result",
        id: String(item.id),
        isError: typeof item.exit_code === "number" && item.exit_code !== 0,
        output: textOf(item.aggregated_output),
      }
    }

    // Reasoning is Codex's private thinking; the Claude backend does not
    // render thinking either, so drop it rather than half-showing it.
    if (item.type === "reasoning") return null

    // Anything new (file_change, web_search, ...) still gets a row: a silently
    // dropped tool call leaves the transcript claiming nothing happened.
    if (!done)
      return { type: "tool-start", id: String(item.id), name: String(item.type ?? "tool"), input: {} }
    return {
      type: "tool-result",
      id: String(item.id),
      isError: item.status === "failed",
      output: textOf(item.aggregated_output ?? item.text),
    }
  }

  return null
}

/** `codex login status` exits 0 and names the login when signed in
 *  ("Logged in using ChatGPT"). Same conservative default as the Claude side. */
export function parseCodexAuth(stdout: string, exitCode: number): boolean {
  if (exitCode !== 0) return false
  // "Not logged in" contains "logged in", so the negative is checked first.
  if (/not logged in/i.test(stdout)) return false
  return /logged in/i.test(stdout)
}
