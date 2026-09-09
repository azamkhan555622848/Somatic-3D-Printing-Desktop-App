from pathlib import Path

import SimpleITK as sitk
from coder3d_medimage.convert import dicom_to_nifti, series_metadata


def test_dicom_to_nifti_produces_volume(synthetic_ct_series: Path, tmp_path: Path):
    out = tmp_path / "nifti"
    files = dicom_to_nifti(synthetic_ct_series, out)
    assert files, "dcm2niix produced no NIfTI output"
    img = sitk.ReadImage(str(files[0]))
    assert img.GetSize()[2] == 8
    assert abs(img.GetSpacing()[2] - 2.0) < 1e-3


def test_series_metadata(synthetic_ct_series: Path):
    meta = series_metadata(synthetic_ct_series)
    assert meta["modality"] == "CT"
    assert meta["slice_thickness_mm"] == 2.0
    assert meta["pixel_spacing_mm"] == [1.0, 1.0]
    assert meta["slices"] == 8
