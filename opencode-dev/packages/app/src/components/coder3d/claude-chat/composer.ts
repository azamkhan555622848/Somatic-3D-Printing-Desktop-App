// Composer rules for the Claude chat, kept out of the view so they can be
// tested. They follow opencode's own prompt (components/prompt-input.tsx):
// ONE button, which is Stop only while a turn is running and the box is empty,
// and a text box that is never locked by a running turn.

export type ComposerState = {
  running: boolean
  blank: boolean
  available: boolean
  /** Whichever agent is selected. The box named Claude while a Codex turn was
   *  running, which is the same wrong-name bug the resumed notice had. */
  agent?: string
}

/** Stop only when there is nothing to send; otherwise the button sends. */
export function composerAction(state: ComposerState): "send" | "stop" {
  return state.running && state.blank ? "stop" : "send"
}

export function composerEnabled(state: ComposerState): boolean {
  if (!state.available) return false
  // Idle with an empty box is the only combination with nothing to do.
  return state.running || !state.blank
}

/** A turn in flight is exactly when the user most wants to type the next one. */
export function inputEnabled(state: ComposerState): boolean {
  return state.available
}

export function placeholder(state: ComposerState): string {
  if (state.running) return "Type the next message — it will be sent when this turn ends…"
  return `Ask ${state.agent || "the agent"} to design something…`
}

// `claude -p` takes one turn at a time, so anything typed mid-turn waits here
// and is sent when the current turn reports its result. Keyed by workspace: two
// windows on two projects must not drain each other's queue.
// `dir` rides along because the queue is keyed by conversation, not workspace,
// and the turn still has to be spawned in the right folder.
export type QueuedMessage<Image = unknown> = { dir: string; text: string; images: Image[] }

export function queueFor<Image>(
  queue: Map<string, QueuedMessage<Image>[]>,
  dir: string,
  message: QueuedMessage<Image>,
): void {
  const existing = queue.get(dir)
  if (existing) existing.push(message)
  else queue.set(dir, [message])
}

export function takeQueued<Image>(
  queue: Map<string, QueuedMessage<Image>[]>,
  dir: string,
): QueuedMessage<Image> | undefined {
  const existing = queue.get(dir)
  const next = existing?.shift()
  if (existing && existing.length === 0) queue.delete(dir)
  return next
}
