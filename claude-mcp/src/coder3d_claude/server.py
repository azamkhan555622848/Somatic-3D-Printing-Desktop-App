"""3D-Coder Claude delegate MCP server (stdio).

Routes heavy design work to Claude Opus through the locally authenticated
Claude Code CLI (the user's Max subscription). The delegated Claude gets the
case folder as its working directory plus the cad/mesh MCP servers, so it can
design, build, and verify geometry end-to-end.
"""
import json
import os
import subprocess
from pathlib import Path

from fastmcp import FastMCP
from coder3d_claude.cmd import build_cmd, full_prompt

mcp = FastMCP("coder3d-claude")

SUBAGENT_MCP_CONFIG = os.environ.get("CODER3D_SUBAGENT_MCP_CONFIG")


def _run(task: str, case_dir: str, model: str, allow_bash: bool,
         timeout_s: int, resume: str | None = None) -> dict:
    cwd = Path(case_dir).resolve()
    if not cwd.is_dir():
        return {"ok": False, "error": f"case_dir does not exist: {cwd}"}
    cmd = build_cmd(model=model, mcp_config=SUBAGENT_MCP_CONFIG,
                    allow_bash=allow_bash, resume=resume)
    try:
        # Prompt goes over stdin — see build_cmd for the Windows cmd-shim reason.
        r = subprocess.run(cmd, cwd=str(cwd), input=full_prompt(task),
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout_s)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"delegated run exceeded {timeout_s}s and was killed"}
    if r.returncode != 0 and not r.stdout.strip():
        return {"ok": False, "error": (r.stderr or f"claude exited {r.returncode}")[-2000:]}
    try:
        payload = json.loads(r.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": "unparseable claude output", "raw": r.stdout[-2000:]}
    return {
        "ok": not payload.get("is_error", False),
        "result": payload.get("result"),
        "session_id": payload.get("session_id"),
        "num_turns": payload.get("num_turns"),
        "duration_s": round((payload.get("duration_ms") or 0) / 1000, 1),
    }


@mcp.tool
def claude_delegate(task: str, case_dir: str, model: str = "opus",
                    allow_bash: bool = False, timeout_s: int = 900) -> dict:
    """Delegate a design task to Claude Opus via the user's Claude Code Max
    subscription (headless). The delegate works INSIDE case_dir with file tools
    plus the cad/mesh MCP servers (cad_run, mesh_info, mesh_render, ...), so give
    it self-contained tasks like "design a parametric X in cad/x.py, build it,
    verify watertight". Returns {ok, result, session_id, num_turns, duration_s};
    keep session_id to follow up with claude_continue."""
    return _run(task, case_dir, model, allow_bash, timeout_s)


@mcp.tool
def claude_continue(session_id: str, prompt: str, case_dir: str,
                    model: str = "opus", allow_bash: bool = False,
                    timeout_s: int = 900) -> dict:
    """Continue a previous claude_delegate session (same context) with a
    follow-up instruction, e.g. refinements after the user saw the preview."""
    return _run(prompt, case_dir, model, allow_bash, timeout_s, resume=session_id)


if __name__ == "__main__":
    mcp.run()
