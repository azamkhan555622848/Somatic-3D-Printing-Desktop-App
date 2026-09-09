"""3D-Coder CAD MCP server (stdio)."""
from fastmcp import FastMCP
from coder3d_cad.runner import run_script, _load_module
from pathlib import Path

mcp = FastMCP("coder3d-cad")


@mcp.tool
def cad_run(script_path: str, params: dict | None = None) -> dict:
    """Run a PARAMS+build() build123d script. Writes STL/GLB/STEP + manifest
    into its case folder and returns the manifest (error field on failure)."""
    return run_script(script_path, params)


@mcp.tool
def cad_params(script_path: str) -> dict:
    """Return the PARAMS schema of a CAD script without building it."""
    return dict(_load_module(Path(script_path).resolve()).PARAMS)


if __name__ == "__main__":
    mcp.run()
