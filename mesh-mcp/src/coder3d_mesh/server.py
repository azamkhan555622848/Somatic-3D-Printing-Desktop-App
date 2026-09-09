"""3D-Coder mesh MCP server (stdio)."""
from fastmcp import FastMCP
from coder3d_mesh import ops, render

mcp = FastMCP("coder3d-mesh")


@mcp.tool
def mesh_info(path: str) -> dict:
    """Counts, bounds (mm), watertightness, volume, and a units sanity flag."""
    return ops.mesh_info(path)


@mcp.tool
def mesh_repair(path: str, out_path: str | None = None) -> dict:
    """Repair to watertight (trimesh, PyMeshLab fallback). Returns before/after info."""
    return ops.mesh_repair(path, out_path)


@mcp.tool
def mesh_render(path: str, out_dir: str | None = None, size: int = 640) -> list[str]:
    """Render iso/front/top/right PNGs of a mesh. Read them to SEE the geometry."""
    return render.render_views(path, out_dir, size=size)


if __name__ == "__main__":
    mcp.run()
