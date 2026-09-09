import numpy as np, trimesh
from pathlib import Path

def _box_stl(tmp_path: Path, holed=False) -> Path:
    m = trimesh.creation.box(extents=(20.0, 10.0, 5.0))
    if holed:
        m.faces = m.faces[:-2]          # rip two triangles -> not watertight
    p = tmp_path / ("holed.stl" if holed else "box.stl")
    m.export(p)
    return p

def test_info_watertight_box(tmp_path):
    from coder3d_mesh.ops import mesh_info
    info = mesh_info(str(_box_stl(tmp_path)))
    assert info["watertight"] is True
    assert np.allclose(sorted(info["bbox_mm"]), [5.0, 10.0, 20.0])
    assert abs(info["volume_mm3"] - 1000.0) < 1e-3
    assert info["units_suspect"] is False

def test_info_flags_suspect_units(tmp_path):
    from coder3d_mesh.ops import mesh_info
    m = trimesh.creation.box(extents=(0.02, 0.01, 0.005))   # meters-scale box
    p = tmp_path / "tiny.stl"; m.export(p)
    assert mesh_info(str(p))["units_suspect"] is True

def test_repair_closes_holes(tmp_path):
    from coder3d_mesh.ops import mesh_info, mesh_repair
    p = _box_stl(tmp_path, holed=True)
    assert mesh_info(str(p))["watertight"] is False
    rep = mesh_repair(str(p))
    assert rep["out"]["watertight"] is True
    assert Path(rep["out_path"]).is_file()
