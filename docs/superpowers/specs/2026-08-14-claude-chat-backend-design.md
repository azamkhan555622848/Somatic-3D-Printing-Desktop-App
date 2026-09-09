# 3D-Coder — Claude-Chat Backend Design Spec

**Date:** 2026-08-14
**Status:** Approved (Azam, 2026-08-14, in-chat)
**Prior art:** `2026-08-13-3d-coder-design.md` (§4.5 delegate), the shipped `coder3d-claude` delegate MCP, the coder3d main-process chassis (watcher/files IPC).

## 1. Problem

The composer badge says "Claude Opus 5 · High" but the chat brain is GLM-5.2;
Claude from the user's Max subscription only runs inside `claude_delegate`
tool calls. The user wants the conversation itself to be Claude, billed to
the subscription. Compliance constraint (user-stated, verified in code): no
OAuth-token extraction into opencode — this build's runtime rejects Anthropic
OAuth anyway (`native-runtime.ts:60`). Subscription Claude exists only inside
Claude Code. Therefore: the chat routes **through headless Claude Code**,
which remains the authenticated Anthropic application.

## 2. Decisions (brainstormed 2026-08-14)

| Decision | Choice |
|---|---|
| UI surface | **Claude replaces the chat** in the left pane by default; stock GLM/opencode chat stays reachable behind a persisted header toggle. |
| Session model | **One continuous Claude session per project**, resumed across restarts; **New chat** button forks off a fresh session. No history browser in v1. |
| Autonomy | **Full**: Read/Write/Edit/Glob/Grep/**Bash** + `mcp__cad`/`mcp__mesh`/`mcp__medimage`, `--permission-mode acceptEdits`, `--add-dir <workspace>`. Machine-owned walls (provenance / meshes/qa / .identity) stay denied. |
| Process model | **Per-turn spawn** of `claude -p --resume <id>` (proven delegate pattern; interrupt = kill process tree; robust on Windows). No persistent stdin process in v1. |
| Model | Pinned `--model opus` (Opus 5, default High reasoning) — the badge becomes literally true. |
| CLI floor | claude ≥ 2.1.231 (2.1.232 installed; has `--include-partial-messages`, `--fork-session`, stream-json in/out). |

## 3. Architecture

```
renderer (SolidJS)                    electron main                       claude CLI
┌───────────────────┐  IPC            ┌─────────────────────┐  spawn      ┌──────────────┐
│ ClaudeChat view   │───send(text)───▶│ ClaudeChatManager   │───argv+stdin▶│ claude -p    │
│  message list     │◀──events────────│  spawn/kill child   │◀──NDJSON────│  --resume    │
│  composer + Stop  │───stop()───────▶│  parse stream-json  │             │  Opus 5      │
│  New chat         │───newChat()────▶│  session-id store   │             │  (Max sub)   │
└───────────────────┘                 └─────────────────────┘             └──────────────┘
```

- **Main:** `packages/desktop/src/main/coder3d/claude-chat.ts` — arg builder,
  NDJSON line parser, child lifecycle, session store. IPC channels join the
  existing `registerCoder3dIpc` block; preload exposes
  `api.coder3d.claudeChat = { send, stop, newChat, onEvent, state }`.
- **Renderer:** `packages/app/src/components/coder3d/claude-chat/` — chat view
  + event-to-message reducer (pure module, unit-tested).
- The preview panel, watcher, Medical/Design views are untouched — they react
  to the filesystem, not to which brain wrote the files.

## 4. Invocation

```
claude -p --model opus \
  --output-format stream-json --include-partial-messages --verbose \
  --permission-mode acceptEdits \
  --add-dir <workspace> \
  --mcp-config <3dcoder-config/claude-subagent-mcp.json> \
  --allowedTools Read,Write,Edit,Glob,Grep,Bash,mcp__cad,mcp__mesh,mcp__medimage \
  --disallowedTools "Edit(**/provenance.json),Write(**/provenance.json),Edit(**/meshes/qa/**),Write(**/meshes/qa/**),Edit(**/.identity/**),Write(**/.identity/**),Read(**/.identity/**)" \
  [--resume <sessionId>]
```

- Prompt rides **stdin** (npm cmd-shim truncates argv at newlines).
- cwd = workspace directory.
- The walls duplicate `claude-mcp/src/coder3d_claude/cmd.py` — each file
  cross-references the other; a test on each side asserts the same deny list.
- A short `--append-system-prompt` names the app, the case-folder convention
  (`cases/<id>/…`), and the rule that gate verdicts come from tools only.

## 5. Event protocol (main → renderer)

Parsed from claude's stream-json lines; forwarded as:

| Event | Source line | Payload |
|---|---|---|
| `init` | `{"type":"system","subtype":"init",…}` | `sessionId`, `model` |
| `text-delta` | `stream_event` content_block_delta (text) | `text` |
| `tool-start` | assistant message `tool_use` block | `name`, `inputPreview` (first ~120 chars of JSON) |
| `tool-result` | user message `tool_result` block | `name`, `isError` |
| `assistant-text` | assistant message text block (fallback if no deltas) | `text` |
| `result` | `{"type":"result",…}` | `ok`, `sessionId`, `numTurns`, `durationMs` |
| `error` | non-zero exit / unparseable output / spawn failure | `message` (stderr tail ≤ 2000 chars) |

Unknown line types are ignored (forward-compatible). The renderer reducer
folds events into `{role, parts:[{kind:"text"|"tool",…}]}` messages.

## 6. Session store

`<workspace>/.coder3d/claude-session.json` → `{ "sessionId": "<uuid>" }`.
- Written on every `init` event.
- `.coder3d/` is already watcher-ignored and inert to the artifact router.
- **New chat**: delete the file; next turn starts a fresh session (the old
  transcript stays in Claude Code's own store, recoverable manually).
- After app restart the UI can't show past bubbles (v1 accepts this): it shows
  a "Resumed previous session" divider; backfill from Claude Code's local
  transcript JSONL is a v2 item.

## 7. UI

- **Header:** `Claude · Opus 5 · High` (true now) · **New chat** · **Stop**
  (only while a turn runs) · small **GLM** toggle → stock opencode chat
  (persisted `coder3d-chat-backend` in localStorage; default `claude`).
- **Message list:** user bubbles right; assistant markdown left (reuse the
  app's markdown renderer); tool chips inline in order:
  `▸ mask_to_mesh(liver) ✓` / `✗` on error, collapsed by default.
- **Composer:** multiline textarea, Enter sends / Shift+Enter newline,
  disabled while a turn runs (Stop is the escape).
- **GLM fallback mode:** the old composer stays as-is except the delegate
  badge text becomes honest: `delegates to Claude Opus 5` (it no longer
  claims to BE the chat model).
- Mount: the session page's chat column renders `ClaudeChat` when the backend
  toggle is `claude`, regardless of which opencode session tab is selected.

## 8. Errors

| Failure | Behavior |
|---|---|
| `claude` not on PATH | Banner in the chat view with install/sign-in hint; composer disabled. |
| Spawn/exit non-zero, no parseable output | Error bubble with stderr tail; turn ends; session unchanged. |
| Auth expired | Claude Code's own error text surfaces in the error bubble ("run `claude` and sign in"). |
| Stop mid-turn | Kill process tree (`taskkill /T /F`); partial output stays rendered; next turn resumes the session. |
| Stale session id (deleted store) | `--resume` failure → retry once without `--resume`, then persist the new id. |

## 9. PHI note

Chat turns go to Anthropic exactly as any Claude Code usage does. Patient
data is de-identified at import (P2) before it can appear in any prompt or
file Claude reads; `cases/.identity/` is Read-denied to Claude.

## 10. Testing

- **Unit (bun, renderer):** event reducer — fixture NDJSON lines (recorded
  from a real `claude -p --output-format stream-json` run) → expected message
  parts; arg builder — walls present, `--resume` inclusion, no `\n` in argv.
- **Unit (bun, desktop):** parser handles split/partial NDJSON lines across
  chunk boundaries; unknown types ignored.
- **Cross-check:** a test asserting the TS deny list equals cmd.py's
  `DENY_TOOLS`.
- **Live (CDP):** send a turn that triggers a tool (`ask Claude to run
  mesh_info on the demo tube rack`), verify chips + streamed text render,
  Stop mid-turn, restart the app, verify resume divider + continued context.

## 11. Out of scope (v1)

Session history browser; transcript backfill after restart; model/effort
picker (pinned Opus/High); image attachments; permission-approval UI
(acceptEdits is the mode); removing the GLM path entirely.
