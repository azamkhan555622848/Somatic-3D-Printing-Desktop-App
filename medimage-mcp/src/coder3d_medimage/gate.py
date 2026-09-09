"""Mesh Gate (spec §5.3) — checks run in tool code, never agent judgment.

watertight/manifold; min wall >= 1.2mm; bbox within 1.05x of the mask bbox
(catches 10x/1000x unit bugs); HD95 vs the UNSMOOTHED segmentation surface
<= 0.5mm with MSD reported. The report lands in meshes/qa/ (machine-owned).
"""
import json
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import trimesh
from scipy.spatial import cKDTree

from coder3d_medimage.mesh_extract import mask_to_mesh
from coder3d_medimage.provenance import append_entry

_SAMPLES = 50_000


def _mask_bbox_extents_mm(mask_path: Path) -> np.ndarray:
    img = sitk.ReadImage(str(mask_path))
    arr = sitk.GetArrayFromImage(img)  # z, y, x
    nz = np.argwhere(arr > 0)
    span_vox = nz.max(axis=0) - nz.min(axis=0) + 1  # z, y, x
    sx, sy, sz = img.GetSpacing()
    return np.array([span_vox[2] * sx, span_vox[1] * sy, span_vox[0] * sz])


def _surface_distances(mesh: trimesh.Trimesh, ref: trimesh.Trimesh) -> tuple[float, float]:
    a, _ = trimesh.sample.sample_surface(mesh, _SAMPLES)
    b, _ = trimesh.sample.sample_surface(ref, _SAMPLES)
    da = cKDTree(b).query(a, workers=-1)[0]
    db = cKDTree(a).query(b, workers=-1)[0]
    hd95 = float(max(np.percentile(da, 95), np.percentile(db, 95)))
    msd = float((da.mean() + db.mean()) / 2)
    return hd95, msd


def mesh_gate(mesh_path: Path, mask_path: Path, case_dir: Path,
              min_wall_mm: float = 1.2, hd95_tol_mm: float = 0.5,
              bbox_ratio_max: float = 1.05) -> dict:
    case_dir = Path(case_dir)
    mesh = trimesh.load(str(mesh_path), force="mesh")

    watertight = bool(mesh.is_watertight and mesh.is_winding_consistent)

    # Local thickness: inward ray from the surface until it exits the part.
    # (max_sphere is numerically useless on faceted surfaces — it returned
    # ~0.4mm on a 40mm solid sphere; the ray method returns the diameter.)
    pts, face_idx = trimesh.sample.sample_surface(mesh, 2000)
    normals = mesh.face_normals[face_idx]
    try:
        th = trimesh.proximity.thickness(mesh, pts - normals * 1e-3,
                                         normals=normals, method="ray")
        finite = th[np.isfinite(th) & (th > 0)]
        wall_p02 = float(np.percentile(finite, 2)) if finite.size else float("nan")
    except Exception:
        wall_p02 = float("nan")
    wall_ok = bool(wall_p02 >= min_wall_mm) if np.isfinite(wall_p02) else False

    mask_ext = _mask_bbox_extents_mm(mask_path)
    mesh_ext = mesh.bounding_box.extents
    ratios = np.maximum(mesh_ext / mask_ext, mask_ext / mesh_ext)
    bbox_ok = bool(ratios.max() <= bbox_ratio_max)

    if bbox_ok:
        ref_result = mask_to_mesh(mask_path, case_dir, name=f"_ref_{Path(mesh_path).stem}",
                                  smooth_iterations=0)
        ref = trimesh.load(ref_result["stl"], force="mesh")
        hd95, msd = _surface_distances(mesh, ref)
        Path(ref_result["stl"]).unlink(missing_ok=True)
        Path(ref_result["glb"]).unlink(missing_ok=True)
    else:
        hd95, msd = float("inf"), float("inf")  # wrong units: distance is meaningless
    dev_ok = bool(hd95 <= hd95_tol_mm)

    checks = {
        "watertight": {"passed": watertight},
        "min_wall": {"passed": wall_ok, "wall_p02_mm": wall_p02, "threshold_mm": min_wall_mm},
        "bbox_sanity": {"passed": bbox_ok, "max_ratio": float(ratios.max()),
                        "mesh_extents_mm": [float(v) for v in mesh_ext],
                        "mask_extents_mm": [float(v) for v in mask_ext]},
        "deviation": {"passed": dev_ok, "hd95_mm": hd95, "msd_mm": msd,
                      "tolerance_mm": hd95_tol_mm},
    }
    passed = all(c["passed"] for c in checks.values())

    qa_dir = case_dir / "meshes" / "qa"
    qa_dir.mkdir(parents=True, exist_ok=True)
    report_path = qa_dir / f"{Path(mesh_path).stem}.gate.json"
    report = {"passed": passed, "mesh": str(mesh_path), "mask": str(mask_path), "checks": checks}
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    append_entry(case_dir, step="mesh_gate", tool="medimage.mesh_gate",
                 params={"min_wall_mm": min_wall_mm, "hd95_tol_mm": hd95_tol_mm},
                 inputs=[Path(mesh_path), Path(mask_path)], outputs=[report_path])
    return {"passed": passed, "checks": checks, "report": str(report_path)}
