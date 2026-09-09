from pathlib import Path

import numpy as np
import pydicom
import pytest
import SimpleITK as sitk
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid


def write_ct_series(folder: Path, slices: int = 8, size: int = 32) -> Path:
    """A tiny but geometrically valid CT series pydicom/dcm2niix both accept."""
    folder.mkdir(parents=True, exist_ok=True)
    study_uid, series_uid, for_uid = generate_uid(), generate_uid(), generate_uid()
    rng = np.random.default_rng(0)
    for i in range(slices):
        ds = Dataset()
        ds.file_meta = FileMetaDataset()
        ds.file_meta.MediaStorageSOPClassUID = CTImageStorage
        ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID, ds.SeriesInstanceUID = study_uid, series_uid
        ds.FrameOfReferenceUID = for_uid
        ds.Modality = "CT"
        ds.PatientName = "Doe^Jane"
        ds.PatientID = "HOSP-12345"
        ds.PatientBirthDate = "19700101"
        ds.PatientSex = "F"
        ds.InstitutionName = "Test Hospital"
        ds.ReferringPhysicianName = "Ref^Dr"
        ds.AccessionNumber = "ACC001"
        ds.StudyDate = ds.SeriesDate = ds.AcquisitionDate = "20260101"
        ds.StudyTime = "120000"
        ds.Rows = ds.Columns = size
        ds.PixelSpacing = [1.0, 1.0]
        ds.SliceThickness = 2.0
        ds.ImagePositionPatient = [0.0, 0.0, float(i) * 2.0]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.InstanceNumber = i + 1
        ds.RescaleIntercept, ds.RescaleSlope = -1024.0, 1.0
        ds.BitsAllocated = ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 1
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.PixelData = rng.integers(0, 800, (size, size), dtype=np.int16).tobytes()
        pydicom.dcmwrite(folder / f"slice_{i:03d}.dcm", ds, enforce_file_format=True)
    return folder


def write_sphere_mask(path: Path, radius_mm: float = 20.0, spacing=(1.0, 1.0, 1.0)) -> Path:
    size = int(2 * radius_mm / min(spacing)) + 20
    zz, yy, xx = np.mgrid[0:size, 0:size, 0:size].astype(np.float32)
    c = size / 2
    r = np.sqrt(((xx - c) * spacing[0]) ** 2 + ((yy - c) * spacing[1]) ** 2 + ((zz - c) * spacing[2]) ** 2)
    img = sitk.GetImageFromArray((r <= radius_mm).astype(np.uint8))
    img.SetSpacing(spacing)
    sitk.WriteImage(img, str(path))
    return path


@pytest.fixture
def synthetic_ct_series(tmp_path: Path) -> Path:
    return write_ct_series(tmp_path / "dicom_src")


@pytest.fixture
def sphere_mask(tmp_path: Path) -> Path:
    return write_sphere_mask(tmp_path / "sphere.nii.gz")
