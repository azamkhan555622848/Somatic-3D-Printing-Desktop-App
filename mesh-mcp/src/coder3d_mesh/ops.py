"""Mesh inspection + repair. trimesh first; PyMeshLab as the heavy fallback."""
from pathlib import Path
import numpy as np
import trimesh


def _info(m: trimesh.Trimesh, path: str) -> dict:
    ext = [float(x) for x in m.extents]
    biggest = max(ext) if ext else 0.0
    suspect = biggest < 1.0 or biggest > 1000.0
    note = ("largest extent %.4g mm — check units (DICOM/CAD are mm)" % biggest
            if suspect else "extents plausible for mm")
    return {
        "path": path, "faces": int(len(m.faces)), "vertices": int(len(m.vertices)),
        "watertight": bool(m.is_watertight), "bbox_mm": ext,
        "volume_mm3": float(abs(m.volume)) if m.is_watertight else None,
        "units_suspect": bool(suspect), "units_note": note,
    }


def mesh_info(path: str) -> dict:
    return _info(trimesh.load(path, force="mesh"), path)


def mesh_repair(path: str, out_path: str | None = None) -> dict:
    src = Path(path)
    out = Path(out_path) if out_path else src.with_suffix(".repaired.stl")
    m = trimesh.load(path, force="mesh")
    before = _info(m, path)
    m.merge_vertices()
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    trimesh.repair.fill_holes(m)
    trimesh.repair.fix_normals(m)
    if not m.is_watertight:                       # heavier artillery
        import pymeshlab
        ms = pymeshlab.MeshSet()
        ms.load_new_mesh(str(src))
        ms.meshing_remove_duplicate_vertices()
        ms.meshing_repair_non_manifold_edges()
        ms.meshing_close_holes(maxholesize=400)
        ms.save_current_mesh(str(out))
        m = trimesh.load(str(out), force="mesh")
    else:
        m.export(str(out))
    return {"in": before, "out": _info(m, str(out)), "out_path": str(out)}
