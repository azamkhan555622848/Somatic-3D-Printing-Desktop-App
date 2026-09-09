// When the coder3d-claude delegate server is connected, the composer hides the
// real model/variant pickers and shows this badge instead: design work routes
// to Claude through the user's Claude Code subscription, so the chat model
// picker is noise. Disabling the server in the MCP popover brings the pickers
// back — that is the escape hatch for changing the underlying chat model.
import { useSync } from "@/context/sync"
import { useChatBackend } from "./claude-chat/claude-chat"

export const DELEGATE_SERVER = "coder3d-claude"
// Labels mirror claude-mcp/src/coder3d_claude/cmd.py: `--model opus` resolves
// to the subscription's current Opus (Opus 5) at its default reasoning (high).
// If the delegate's model changes there, update these two strings.
export const DELEGATE_MODEL_LABEL = "Opus 5"
export const DELEGATE_MODE_LABEL = "High"

export function useClaudeDelegateActive() {
  const sync = useSync()
  return () => sync().data.mcp?.[DELEGATE_SERVER]?.status === "connected"
}

// In GLM mode the chat model is NOT Claude — it only delegates to it. Say so,
// and make the badge the one-click way back to the Claude chat backend.
export function Coder3dDelegateBadge() {
  const [, setBackend] = useChatBackend()
  return (
    <button
      type="button"
      class="flex items-center gap-1.5 px-1.5 h-6 text-12-regular text-text-weak hover:text-text-base"
      title={
        `This chat runs on the picked model and delegates heavy design work to Claude ${DELEGATE_MODEL_LABEL} ` +
        "via your Claude Code subscription. Click to make Claude the chat itself."
      }
      onClick={() => setBackend("claude")}
    >
      <span>delegates to</span>
      <span class="text-text-base font-medium">Claude {DELEGATE_MODEL_LABEL}</span>
    </button>
  )
}
