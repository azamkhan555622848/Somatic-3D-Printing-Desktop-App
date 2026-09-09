"""Offscreen multi-view PNG renders — the agent's eyes on its own geometry."""
from pathlib import Path
import numpy as np

VIEWS = {  # name -> (front vector, up vector) for Open3D camera
    "iso":   ((1.0, -1.0, 0.7), (0, 0, 1)),
    "front": ((0.0, -1.0, 0.0), (0, 0, 1)),
    "top":   ((0.0,  0.0, 1.0), (0, 1, 0)),
    "right": ((1.0,  0.0, 0.0), (0, 0, 1)),
}


def _out_dir_for(mesh_path: Path, out_dir: str | None) -> Path:
    if out_dir:
        d = Path(out_dir)
    elif mesh_path.parent.name == "meshes":
        d = mesh_path.parent.parent / ".coder3d" / "renders"
    else:
        d = mesh_path.parent
    d.mkdir(parents=True, exist_ok=True)
    return d


def _render_open3d(mesh_path: Path, out: Path, size: int) -> list[str]:
    import open3d as o3d
    mesh = o3d.io.read_triangle_mesh(str(mesh_path))
    mesh.compute_vertex_normals()
    written = []
    for name, (front, up) in VIEWS.items():
        r = o3d.visualization.rendering.OffscreenRenderer(size, size)
        mat = o3d.visualization.rendering.MaterialRecord()
        mat.shader = "defaultLit"
        r.scene.add_geometry("m", mesh, mat)
        r.scene.set_background([1, 1, 1, 1])
        bounds = mesh.get_axis_aligned_bounding_box()
        r.setup_camera(60.0, bounds, bounds.get_center())
        r.scene.camera.look_at(bounds.get_center(),
                               bounds.get_center() + np.array(front) * np.max(bounds.get_extent()) * 2.2,
                               up)
        img = r.render_to_image()
        f = out / f"{mesh_path.stem}-{name}.png"
        o3d.io.write_image(str(f), img)
        written.append(str(f))
    return written


def _render_matplotlib(mesh_path: Path, out: Path, size: int) -> list[str]:
    """Pure-software fallback — no GL context needed (Open3D wheels lack EGL
    headless on win32). Lambert-ish face shading via Poly3DCollection."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    import trimesh

    m = trimesh.load(str(mesh_path), force="mesh")
    if len(m.faces) > 60_000:
        try:
            m = m.simplify_quadric_decimation(face_count=60_000)
        except BaseException:
            pass  # decimation is an optimization, never a requirement
    tris = m.vertices[m.faces]
    normals = m.face_normals
    mins, maxs = m.bounds
    center = (mins + maxs) / 2
    radius = float((maxs - mins).max()) / 2 * 1.05
    written = []
    for name, (front, _up) in VIEWS.items():
        f = np.array(front, dtype=float)
        f /= np.linalg.norm(f)
        shade = 0.35 + 0.65 * np.clip(normals @ f, 0, 1)
        colors = np.stack(
            [shade * 0.62, shade * 0.71, shade * 0.78, np.ones_like(shade)], axis=1)
        fig = plt.figure(figsize=(size / 100, size / 100), dpi=100)
        ax = fig.add_subplot(projection="3d")
        ax.add_collection3d(Poly3DCollection(tris, facecolors=colors, edgecolors="none"))
        ax.set_xlim(center[0] - radius, center[0] + radius)
        ax.set_ylim(center[1] - radius, center[1] + radius)
        ax.set_zlim(center[2] - radius, center[2] + radius)
        azim = float(np.degrees(np.arctan2(f[1], f[0])))
        elev = float(np.degrees(np.arcsin(f[2])))
        ax.view_init(elev=elev, azim=azim)
        ax.set_proj_type("ortho")
        ax.set_axis_off()
        fpath = out / f"{mesh_path.stem}-{name}.png"
        fig.savefig(fpath, dpi=100, bbox_inches="tight", pad_inches=0)
        plt.close(fig)
        written.append(str(fpath))
    return written


def render_views(path: str, out_dir: str | None = None, views: int = 4, size: int = 640) -> list[str]:
    mesh_path = Path(path).resolve()
    out = _out_dir_for(mesh_path, out_dir)
    try:
        return _render_open3d(mesh_path, out, size)[:views]
    except Exception:
        return _render_matplotlib(mesh_path, out, size)[:views]
