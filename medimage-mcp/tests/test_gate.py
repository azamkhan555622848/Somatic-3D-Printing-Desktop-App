import json
from pathlib import Path

import trimesh
from coder3d_medimage.gate import mesh_gate
from coder3d_medimage.mesh_extract import mask_to_mesh


def test_smoothed_sphere_passes_gate(sphere_mask, tmp_path):
    r = mask_to_mesh(sphere_mask, tmp_path, name="sphere")
    g = mesh_gate(Path(r["stl"]), sphere_mask, tmp_path)
    assert g["passed"] is True
    assert g["checks"]["deviation"]["hd95_mm"] <= 0.5
    report = json.loads(Path(g["report"]).read_text(encoding="utf-8"))
    assert report["passed"] is True


def test_scaled_mesh_fails_bbox_sanity(sphere_mask, tmp_path):
    r = mask_to_mesh(sphere_mask, tmp_path, name="sphere")
    m = trimesh.load(r["stl"])
    m.apply_scale(10.0)  # classic cm-vs-mm bug
    bad = tmp_path / "meshes" / "sphere_x10.stl"
    m.export(bad)
    g = mesh_gate(bad, sphere_mask, tmp_path)
    assert g["passed"] is False
    assert g["checks"]["bbox_sanity"]["passed"] is False


def test_open_mesh_fails_watertight(sphere_mask, tmp_path):
    r = mask_to_mesh(sphere_mask, tmp_path, name="sphere")
    m = trimesh.load(r["stl"])
    m.faces = m.faces[:-50]  # rip a hole
    bad = tmp_path / "meshes" / "sphere_open.stl"
    m.export(bad)
    g = mesh_gate(bad, sphere_mask, tmp_path)
    assert g["passed"] is False
    assert g["checks"]["watertight"]["passed"] is False
