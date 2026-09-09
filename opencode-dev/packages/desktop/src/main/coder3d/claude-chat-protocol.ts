// Pure protocol layer for the Claude chat backend: argv construction and
// stream-json line parsing. No electron imports, so bun can test it directly.
//
// The deny walls MUST mirror claude-mcp/src/coder3d_claude/cmd.py DENY_TOOLS —
// a test on each side pins the pair together (spec §4).

export const DENY_TOOLS = [
  "Edit(**/provenance.json)",
  "Write(**/provenance.json)",
  "Edit(**/meshes/qa/**)",
  "Write(**/meshes/qa/**)",
  "Edit(**/prints/qa/**)",
  "Write(**/prints/qa/**)",
  "Edit(**/.identity/**)",
  "Write(**/.identity/**)",
  "Read(**/.identity/**)",
]

// A tool that is NOT on this list dead-ends: `claude -p` is non-interactive, so
// the permission prompt it would raise has nowhere to appear and the turn just
// reports "blocked" — the user cannot approve it from here at any price.
// Anything the design brain genuinely needs therefore has to be listed up front.
const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  // Design work is full of external ground truth: brace and hinge size charts,
  // ISO/ASTM dimensions, filament datasheets, implant geometry references.
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "mcp__cad",
  "mcp__mesh",
  "mcp__medimage",
  "mcp__print",
]

const SYSTEM_APPEND =
  "You are the design brain of 3D-Coder, a medical 3D-printing workspace. " +
  "Work happens in case folders (cases/<id>/ with dicom, nifti, segmentations, meshes, cad, prints). " +
  "Use the cad/mesh/medimage/print MCP tools for geometry, imaging and slicing work; gate verdicts and " +
  "provenance come from tool code only and their files are read-only to you. " +
  // Without this the model offers to "wait for approval" on a blocked tool and
  // the user answers "I approve" into a void — there is no prompt to accept.
  "This session is non-interactive: no permission prompt can reach the user, so never ask them to " +
  "approve or grant a tool. If a tool is unavailable, say plainly which one and what the user would " +
  "have to change, then continue with what you do have."

// Tool output can be a whole file; cap it so a single Read cannot flood IPC.
const OUTPUT_CAP = 60_000

export const CLAUDE_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const
export const CLAUDE_IMAGE_LIMIT = 4
export const CLAUDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export type ClaudeImageMime = (typeof CLAUDE_IMAGE_MIMES)[number]
export type ClaudeChatImage = {
  name: string
  mime: ClaudeImageMime
  data: string
}

export type ClaudeImageValidationError = "too-many" | "unsupported-type" | "empty" | "too-large" | "invalid-data"

function base64Bytes(data: string) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.floor((data.length * 3) / 4) - padding
}

export function validateClaudeImages(images: readonly unknown[]): ClaudeImageValidationError | undefined {
  if (images.length > CLAUDE_IMAGE_LIMIT) return "too-many"
  for (const image of images) {
    if (!image || typeof image !== "object") return "invalid-data"
    const candidate = image as Partial<ClaudeChatImage>
    if (typeof candidate.mime !== "string" || !CLAUDE_IMAGE_MIMES.includes(candidate.mime as ClaudeImageMime))
      return "unsupported-type"
    if (typeof candidate.name !== "string" || typeof candidate.data !== "string") return "invalid-data"
    if (!candidate.data) return "empty"
    if (candidate.name.length > 512 || candidate.data.length % 4 !== 0) return "invalid-data"
    if (candidate.data.length > Math.ceil((CLAUDE_IMAGE_MAX_BYTES * 4) / 3) + 4) return "too-large"
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(candidate.data)) return "invalid-data"
    if (base64Bytes(candidate.data) > CLAUDE_IMAGE_MAX_BYTES) return "too-large"
  }
}

export function buildClaudeInput(text: string, images: readonly ClaudeChatImage[] = []): string {
  const content: Array<Record<string, unknown>> = []
  if (text.trim()) content.push({ type: "text", text: text.trim() })
  for (const image of images) {
    const name =
      image.name
        .replace(/[\r\n]/g, " ")
        .trim()
        .slice(0, 200) || "image"
    content.push(
      { type: "text", text: `Attached image: ${name}` },
      {
        type: "image",
        source: { type: "base64", media_type: image.mime, data: image.data },
      },
    )
  }
  return `${JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null })}\n`
}

export type ClaudeChatEvent =
  | { type: "init"; sessionId: string; model: string }
  | { type: "text-delta"; text: string }
  | { type: "assistant-text"; messageId: string; text: string }
  | { type: "tool-start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool-result"; id: string; isError: boolean; output: string }
  | { type: "result"; ok: boolean; sessionId: string; numTurns: number }
  | { type: "error"; message: string }
  // History replay only: the live stream never carries user prompts (the
  // composer echoes them itself), but rebuilding a transcript from Claude
  // Code's session file has to reconstruct the user bubbles too.
  | { type: "user-message"; text: string; images: { name: string; src: string }[] }

// tool_result content is either a string or a list of blocks.
function resultText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, OUTPUT_CAP)
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (typeof block === "string" ? block : (block?.text ?? "")))
      .join("\n")
      .slice(0, OUTPUT_CAP)
  }
  return ""
}

// The aliases `claude --help` documents: "Provide an alias for the latest
// model (e.g. 'fable', 'opus', or 'sonnet')". Labels are what the picker shows.
export const CLAUDE_MODELS = [
  { id: "opus", label: "Opus 5" },
  { id: "fable", label: "Fable 5.1" },
  { id: "sonnet", label: "Sonnet 5" },
] as const

/** `claude --help`: effort level "(low, medium, high, xhigh, max)". */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const

export const CLAUDE_DEFAULT_MODEL = "opus"
export const CLAUDE_DEFAULT_EFFORT = "high"

/** `claude auth status` prints JSON with a loggedIn flag. Anything we cannot
 *  read counts as signed out: the cost of being wrong that way is one extra
 *  hint, while the other way lets a turn die mid-chat on a raw auth error. */
export function parseClaudeAuth(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { loggedIn?: unknown } | null
    return parsed?.loggedIn === true
  } catch {
    return false
  }
}

export function buildClaudeArgs(opts: {
  resume?: string
  mcpConfig?: string
  model?: string
  effort?: string
}): string[] {
  const args = [
    "-p",
    "--model",
    opts.model || CLAUDE_DEFAULT_MODEL,
    "--effort",
    opts.effort || CLAUDE_DEFAULT_EFFORT,
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--append-system-prompt",
    SYSTEM_APPEND,
  ]
  if (opts.resume) args.push("--resume", opts.resume)
  if (opts.mcpConfig) args.push("--mcp-config", opts.mcpConfig)
  args.push("--allowedTools", ALLOWED_TOOLS.join(","))
  args.push("--disallowedTools", DENY_TOOLS.join(","))
  return args
}

// cmd.exe reparses the concatenated command line when spawning the npm .cmd
// shim with shell:true; unquoted ( ) , break it, so every arg gets wrapped.
export function quoteArgs(args: string[]): string[] {
  return args.map((a) => `"${a.replaceAll('"', '\\"')}"`)
}

export function splitLines() {
  let buffer = ""
  return {
    push(chunk: string): string[] {
      buffer += chunk
      const parts = buffer.split("\n")
      buffer = parts.pop() ?? ""
      return parts.map((line) => line.trim()).filter((line) => line.length > 0)
    },
  }
}

export function parseStreamLine(line: string): ClaudeChatEvent | null {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (obj === null || typeof obj !== "object") return null

  if (obj.type === "system" && obj.subtype === "init")
    return { type: "init", sessionId: obj.session_id, model: obj.model ?? "" }

  if (obj.type === "stream_event") {
    const delta = obj.event?.type === "content_block_delta" ? obj.event.delta : undefined
    if (delta?.type === "text_delta" && typeof delta.text === "string") return { type: "text-delta", text: delta.text }
    return null
  }

  if (obj.type === "assistant") {
    const content: any[] = obj.message?.content ?? []
    const tool = content.find((c) => c?.type === "tool_use")
    if (tool)
      return {
        type: "tool-start",
        id: tool.id,
        name: tool.name,
        input: (tool.input ?? {}) as Record<string, unknown>,
      }
    const text = content.find((c) => c?.type === "text")
    if (text) return { type: "assistant-text", messageId: obj.message?.id ?? "", text: text.text ?? "" }
    return null
  }

  if (obj.type === "user") {
    const content: any[] = obj.message?.content ?? []
    const result = content.find((c) => c?.type === "tool_result")
    if (result)
      return {
        type: "tool-result",
        id: result.tool_use_id,
        isError: result.is_error === true,
        output: resultText(result.content),
      }
    return null
  }

  // The final summary line carries no "type" key in claude 2.1.232 — detect it
  // by shape instead, or every turn looks like it ended without a result.
  if ("is_error" in obj && "session_id" in obj && "num_turns" in obj)
    return { type: "result", ok: obj.is_error === false, sessionId: obj.session_id, numTurns: obj.num_turns }

  return null
}

// ---- Session history replay ------------------------------------------------
// Claude Code keeps the full transcript of every session in
// ~/.claude/projects/<munged-cwd>/<sessionId>.jsonl. An app restart wipes the
// renderer's transcript but not that file, so on startup the chat replays it
// through the same event model the live stream uses.

// Old tool outputs are rarely expanded; cap them harder than the live stream
// so a long session doesn't ship megabytes over IPC just to fill scrollback.
const HISTORY_OUTPUT_CAP = 8_000
const HISTORY_EVENT_CAP = 1_000

function historyUserEvents(content: unknown): ClaudeChatEvent[] {
  if (typeof content === "string")
    return content.trim() ? [{ type: "user-message", text: content, images: [] }] : []
  if (!Array.isArray(content)) return []
  const events: ClaudeChatEvent[] = []
  const texts: string[] = []
  const images: { name: string; src: string }[] = []
  // buildClaudeInput writes [prompt, "Attached image: name", image, ...]; the
  // marker names the image block that follows and is not user text.
  let pendingName: string | undefined
  for (const block of content as any[]) {
    if (block?.type === "tool_result") {
      events.push({
        type: "tool-result",
        id: block.tool_use_id,
        isError: block.is_error === true,
        output: resultText(block.content).slice(0, HISTORY_OUTPUT_CAP),
      })
    } else if (block?.type === "text" && typeof block.text === "string") {
      const marker = /^Attached image: (.+)$/.exec(block.text)
      if (marker) pendingName = marker[1]
      else if (block.text) texts.push(block.text)
    } else if (block?.type === "image") {
      const source = block.source ?? {}
      if (source.type === "base64" && typeof source.data === "string")
        images.push({ name: pendingName ?? "image", src: `data:${source.media_type};base64,${source.data}` })
      pendingName = undefined
    }
  }
  const text = texts.join("\n")
  if (text.trim() || images.length > 0) events.push({ type: "user-message", text, images })
  return events
}

export function parseHistory(jsonl: string, cap = HISTORY_EVENT_CAP): ClaudeChatEvent[] {
  const events: ClaudeChatEvent[] = []
  const running = new Set<string>() // tool-starts still awaiting their result
  for (const raw of jsonl.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj === null || typeof obj !== "object") continue
    // Injected context (skill expansions, caveats) and subagent traffic never
    // appeared in the app's chat; the replay keeps the same shape.
    if (obj.isMeta === true || obj.isSidechain === true) continue

    if (obj.type === "user") {
      for (const event of historyUserEvents(obj.message?.content)) {
        if (event.type === "tool-result") running.delete(event.id)
        events.push(event)
      }
    } else if (obj.type === "assistant") {
      for (const block of (obj.message?.content ?? []) as any[]) {
        if (block?.type === "tool_use") {
          running.add(block.id)
          events.push({
            type: "tool-start",
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          })
        } else if (block?.type === "text" && block.text) {
          // Adjacent text lines must merge here: applyEvent treats a second
          // assistant-text as the delta-duplicate and would drop it.
          const last = events[events.length - 1]
          if (last?.type === "assistant-text") last.text += `\n\n${block.text}`
          else events.push({ type: "assistant-text", messageId: obj.message?.id ?? "", text: block.text })
        }
      }
    }
  }
  // A Stop or app quit kills a turn between tool-start and tool-result;
  // replayed verbatim those rows would spin forever.
  for (const id of running) events.push({ type: "tool-result", id, isError: true, output: "interrupted" })
  return events.length > cap ? events.slice(events.length - cap) : events
}
