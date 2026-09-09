// Pure reducer: main-process stream events -> renderable chat messages.
// Deltas build text live; a full assistant-text line only renders when no
// delta text arrived for the current part (claude 2.1.232 sends BOTH).

export type ClaudeChatEvent =
  | { type: "init"; sessionId: string; model: string }
  | { type: "text-delta"; text: string }
  | { type: "assistant-text"; messageId: string; text: string }
  | { type: "tool-start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool-result"; id: string; isError: boolean; output: string }
  | { type: "result"; ok: boolean; sessionId: string; numTurns: number }
  | { type: "error"; message: string }
  // History replay only: the live stream never carries user prompts (the
  // composer echoes them itself), but replaying Claude Code's session file
  // after a restart has to reconstruct the user bubbles too.
  | { type: "user-message"; text: string; images: { name: string; src: string }[] }

export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "image"; name: string; src: string }
  | {
      kind: "tool"
      id: string
      name: string
      input: Record<string, unknown>
      output: string
      state: "running" | "ok" | "error"
    }

export type ChatMessage = { role: "user" | "assistant"; parts: ChatPart[] }

export function userMessage(text: string, images: readonly { name: string; src: string }[] = []): ChatMessage {
  return {
    role: "user",
    parts: [
      ...(text ? ([{ kind: "text", text }] as const) : []),
      ...images.map((image) => ({ kind: "image" as const, name: image.name, src: image.src })),
    ],
  }
}

// Returns the message list to write into plus the (copied) assistant message
// to mutate — the copy is what makes the update immutable for Solid.
function withAssistant(messages: ChatMessage[]): [ChatMessage[], ChatMessage] {
  const last = messages[messages.length - 1]
  if (last?.role === "assistant") {
    const copy: ChatMessage = { ...last, parts: [...last.parts] }
    return [[...messages.slice(0, -1), copy], copy]
  }
  const fresh: ChatMessage = { role: "assistant", parts: [] }
  return [[...messages, fresh], fresh]
}

export function applyEvent(messages: ChatMessage[], event: ClaudeChatEvent): ChatMessage[] {
  switch (event.type) {
    case "text-delta": {
      const [next, message] = withAssistant(messages)
      const last = message.parts[message.parts.length - 1]
      if (last?.kind === "text")
        message.parts[message.parts.length - 1] = { kind: "text", text: last.text + event.text }
      else message.parts.push({ kind: "text", text: event.text })
      return next
    }
    case "assistant-text": {
      const [next, message] = withAssistant(messages)
      const last = message.parts[message.parts.length - 1]
      if (last?.kind === "text" && last.text.length > 0) return messages // deltas got here first
      message.parts.push({ kind: "text", text: event.text })
      return next
    }
    case "tool-start": {
      const [next, message] = withAssistant(messages)
      message.parts.push({
        kind: "tool",
        id: event.id,
        name: event.name,
        input: event.input,
        output: "",
        state: "running",
      })
      return next
    }
    case "tool-result":
      return messages.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.kind === "tool" && part.id === event.id
            ? { ...part, output: event.output, state: event.isError ? ("error" as const) : ("ok" as const) }
            : part,
        ),
      }))
    case "error": {
      const [next, message] = withAssistant(messages)
      message.parts.push({ kind: "text", text: `⚠ ${event.message}` })
      return next
    }
    case "user-message":
      return [...messages, userMessage(event.text, event.images)]
    default:
      return messages
  }
}

// mcp__mesh__mesh_info -> mesh_info; Bash stays Bash.
export function shortToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "")
}

export type ToolDisplay = {
  title: string
  subtitle?: string
  args: string[]
  body: string
  bodyKind: "text" | "diff"
  changes?: { additions: number; deletions: number }
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const lineCount = (text: string) => (text.length === 0 ? 0 : text.split("\n").length)

// Trim absolute paths to something readable, the way opencode shows them.
function shortPath(value: string): string {
  const normalized = value.replaceAll("\\", "/")
  // Case-relative paths are the meaningful unit here, absolute or not.
  if (normalized.startsWith("cases/")) return normalized
  const marker = normalized.indexOf("/cases/")
  if (marker >= 0) return normalized.slice(marker + 1)
  const parts = normalized.split("/")
  return parts.length > 3 ? parts.slice(-3).join("/") : normalized
}

// One row per tool, presented like opencode's: what ran, on what, and the
// output underneath. Claude Code's tool names match opencode's for the file
// tools, so the mapping is mostly one-to-one.
export function toolDisplay(part: Extract<ChatPart, { kind: "tool" }>): ToolDisplay {
  const input = part.input ?? {}
  const name = shortToolName(part.name)
  const base: ToolDisplay = { title: name, args: [], body: part.output, bodyKind: "text" }

  switch (part.name) {
    case "Bash": {
      const command = str(input.command) ?? ""
      return {
        ...base,
        title: "Shell",
        subtitle: command.split("\n")[0],
        body: part.output || (str(input.description) ?? ""),
      }
    }
    case "Read": {
      const file = str(input.file_path) ?? ""
      const args: string[] = []
      if (typeof input.offset === "number") args.push(`offset=${input.offset}`)
      if (typeof input.limit === "number") args.push(`limit=${input.limit}`)
      return { ...base, title: "Read", subtitle: shortPath(file), args }
    }
    case "Write": {
      const content = str(input.content) ?? ""
      return {
        ...base,
        title: "Write",
        subtitle: shortPath(str(input.file_path) ?? ""),
        body: content,
        changes: { additions: lineCount(content), deletions: 0 },
      }
    }
    case "Edit": {
      const oldString = str(input.old_string) ?? ""
      const newString = str(input.new_string) ?? ""
      const diff = [
        ...oldString.split("\n").map((line) => `- ${line}`),
        ...newString.split("\n").map((line) => `+ ${line}`),
      ].join("\n")
      return {
        ...base,
        title: "Edit",
        subtitle: shortPath(str(input.file_path) ?? ""),
        body: diff,
        bodyKind: "diff",
        changes: { additions: lineCount(newString), deletions: lineCount(oldString) },
      }
    }
    case "Glob":
      return { ...base, title: "Glob", subtitle: str(input.pattern) }
    case "Grep":
      return {
        ...base,
        title: "Grep",
        subtitle: str(input.pattern),
        args: [str(input.path), str(input.glob)].filter((v): v is string => !!v),
      }
    case "TodoWrite":
      return { ...base, title: "Plan", body: part.output || JSON.stringify(input.todos ?? [], null, 2) }
    case "Task":
      return { ...base, title: "Agent", subtitle: str(input.description) }
    case "WebFetch":
      return { ...base, title: "Fetch", subtitle: str(input.url) }
    case "WebSearch":
      return { ...base, title: "Search", subtitle: str(input.query) }
    default: {
      // MCP tools (cad/mesh/medimage) and anything new: lead with the most
      // path-like argument, then show the raw call underneath its output.
      const entries = Object.entries(input)
      const pathish = entries.find(([key]) => /path|file|mask|volume|script|case|mesh/i.test(key))
      const subtitle = pathish && str(pathish[1]) ? shortPath(str(pathish[1])!) : undefined
      const args = entries
        .filter(([key]) => key !== pathish?.[0])
        .slice(0, 3)
        .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
      return { ...base, subtitle, args, body: part.output || JSON.stringify(input, null, 2) }
    }
  }
}
