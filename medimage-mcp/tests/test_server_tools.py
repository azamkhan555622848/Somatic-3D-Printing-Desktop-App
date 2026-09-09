import json
from pathlib import Path

from coder3d_medimage import server


def test_import_dicom_tool(synthetic_ct_series, tmp_path):
    case = tmp_path / "case1"
    out = server.import_dicom(str(synthetic_ct_series), str(case))
    assert out["case_id"] == "case1"
    assert (case / "dicom").is_dir() and (case / "nifti").is_dir()
    assert out["volumes"], "no NIfTI produced"
    ident = json.loads((case.parent / ".identity" / "case1.json").read_text(encoding="utf-8"))
    assert ident["PatientID"] == "HOSP-12345"
    assert not list(case.rglob("*HOSP-12345*"))  # PHI never lands in the case tree


def test_mask_to_mesh_tool_runs_gate(sphere_mask, tmp_path):
    case = tmp_path / "case2"
    case.mkdir()
    out = server.mask_to_mesh(str(sphere_mask), "sphere", str(case))
    assert out["gate"]["passed"] is True
    assert Path(out["gate"]["report"]).exists()


def test_list_structures_empty(tmp_path):
    out = server.list_structures(str(tmp_path), "nifti/vol.nii.gz")
    assert out["structures"] == {}
