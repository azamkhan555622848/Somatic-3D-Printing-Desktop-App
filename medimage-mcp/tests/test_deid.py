from pathlib import Path

import pydicom
from coder3d_medimage.deid import deidentify_series


def test_deid_strips_phi_and_returns_identity(synthetic_ct_series: Path, tmp_path: Path):
    out = tmp_path / "deid"
    result = deidentify_series(synthetic_ct_series, out, case_id="case-0001")
    assert result["files"] == 8
    assert result["identity"]["PatientName"] == "Doe^Jane"
    assert result["identity"]["PatientID"] == "HOSP-12345"
    ds = pydicom.dcmread(next(out.glob("*.dcm")))
    assert str(ds.PatientName) == "case-0001"
    assert ds.PatientID == "case-0001"
    assert ds.PatientBirthDate == ""
    assert ds.InstitutionName == ""
    assert ds.ReferringPhysicianName == ""
    assert ds.AccessionNumber == ""


def test_deid_regenerates_uids_but_keeps_geometry(synthetic_ct_series: Path, tmp_path: Path):
    src_ds = pydicom.dcmread(next(synthetic_ct_series.glob("*.dcm")))
    out = tmp_path / "deid"
    deidentify_series(synthetic_ct_series, out, case_id="case-0001")
    ds = pydicom.dcmread(next(out.glob("*.dcm")))
    assert ds.StudyInstanceUID != src_ds.StudyInstanceUID
    assert ds.PixelSpacing == src_ds.PixelSpacing
    assert ds.SliceThickness == src_ds.SliceThickness
    assert ds.Modality == "CT"


def test_deid_uid_remap_is_consistent_across_slices(synthetic_ct_series: Path, tmp_path: Path):
    out = tmp_path / "deid"
    deidentify_series(synthetic_ct_series, out, case_id="c1")
    series_uids = {pydicom.dcmread(p).SeriesInstanceUID for p in out.glob("*.dcm")}
    assert len(series_uids) == 1  # one series stays one series
