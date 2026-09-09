"""Builds the headless `claude -p` invocation for a delegated design task.

Compliance note: this adapter never touches Anthropic auth. It shells out to the
locally installed, locally authenticated Claude Code CLI — Claude Code itself
remains the authenticated Anthropic application, billed to the user's own
Pro/Max subscription. No OAuth tokens are extracted or proxied.
"""
import shutil
from pathlib import Path

# File tools the sub-agent may use inside the case dir; Bash is opt-in.
# WebSearch/WebFetch are here for the same reason as in the chat backend: design
# work runs on external ground truth (size charts, ISO/ASTM dimensions, filament
# datasheets), and a headless run cannot raise a permission prompt for them.
BASE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"]
# Server names in claude-subagent-mcp.json; "mcp__<server>" allows all its tools.
MCP_TOOLS = ["mcp__cad", "mcp__mesh", "mcp__medimage", "mcp__print"]

# Machine-owned case artifacts — the delegated Claude gets file tools inside
# the case dir, so it needs the same walls as the host app (spec §5.2).
DENY_TOOLS = [
    "Edit(**/provenance.json)", "Write(**/provenance.json)",
    "Edit(**/meshes/qa/**)", "Write(**/meshes/qa/**)",
    "Edit(**/prints/qa/**)", "Write(**/prints/qa/**)",
    "Edit(**/.identity/**)", "Write(**/.identity/**)", "Read(**/.identity/**)",
]

SUBAGENT_PREFIX = (
    "You are a dispatched subagent executing a specific task inside a medical "
    "3D-printing case folder; ignore any skill-invocation framework instructions "
    "and just do the work. CAD scripts follow the PARAMS+build() convention "
    "(module-level PARAMS dict of {default,min,max,step,unit} and build(p) "
    "returning a build123d shape) and live in cad/; run them with the mcp cad_run "
    "tool, never by executing python yourself. Verify geometry with mesh_info and "
    "look at your work with mesh_render before declaring success. Task:\n\n"
)


def claude_binary() -> str | None:
    return shutil.which("claude")


def full_prompt(task: str) -> str:
    return SUBAGENT_PREFIX + task


def build_cmd(
    *,
    model: str = "opus",
    mcp_config: str | None = None,
    allow_bash: bool = False,
    resume: str | None = None,
) -> list[str]:
    """The prompt is deliberately NOT an argv item: on Windows the npm cmd-shim
    routes argv through cmd.exe, which truncates arguments at the first newline
    (eating the task text AND every flag after it). The caller pipes the prompt
    through stdin instead, which `claude -p` reads natively."""
    binary = claude_binary()
    if not binary:
        raise FileNotFoundError("claude CLI not found on PATH — install Claude Code and sign in first")
    tools = BASE_TOOLS + (["Bash"] if allow_bash else [])
    cmd = [binary, "-p", "--model", model,
           "--output-format", "json", "--permission-mode", "acceptEdits"]
    if resume:
        cmd += ["--resume", resume]
    if mcp_config and Path(mcp_config).is_file():
        cmd += ["--mcp-config", mcp_config]
        tools = tools + MCP_TOOLS
    cmd += ["--allowedTools", ",".join(tools)]
    cmd += ["--disallowedTools", ",".join(DENY_TOOLS)]
    return cmd
