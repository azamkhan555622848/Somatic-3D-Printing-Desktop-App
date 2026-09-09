"""PS3.15 basic-profile de-identification (pragmatic subset).

Identifier tags are blanked or replaced with the opaque case id; instance/
study/series UIDs are regenerated (consistently within the import) so nothing
links back to the hospital PACS. Geometry, modality, and rescale tags are
untouched — they are the data. The ORIGINAL identity is returned to the
caller, which stores it in cases/.identity/ (never here, never in context).
"""
from pathlib import Path

import pydicom
from pydicom.uid import generate_uid

# Tags replaced with the case id
_REPLACE_WITH_CASE_ID = ["PatientName", "PatientID"]
# Tags blanked if present (PS3.15 basic profile, pragmatic subset)
_BLANK = [
    "PatientBirthDate", "PatientSex", "PatientAddress", "PatientTelephoneNumbers",
    "OtherPatientIDs", "OtherPatientNames", "PatientMotherBirthName",
    "InstitutionName", "InstitutionAddress", "ReferringPhysicianName",
    "PerformingPhysicianName", "PhysiciansOfRecord", "OperatorsName",
    "AccessionNumber", "StudyID", "StationName", "DeviceSerialNumber",
    "StudyDate", "SeriesDate", "AcquisitionDate", "ContentDate",
    "StudyTime", "SeriesTime", "AcquisitionTime", "ContentTime",
]
_UID_TAGS = ["StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID", "FrameOfReferenceUID"]


def deidentify_series(src: Path, dst: Path, case_id: str) -> dict:
    src, dst = Path(src), Path(dst)
    dst.mkdir(parents=True, exist_ok=True)
    uid_map: dict[str, str] = {}
    identity: dict[str, str] = {}
    count = 0
    for path in sorted(src.rglob("*")):
        if not path.is_file():
            continue
        try:
            ds = pydicom.dcmread(path)
        except Exception:
            continue  # non-DICOM stray file in the export
        if not identity:
            identity = {
                "PatientName": str(ds.get("PatientName", "")),
                "PatientID": str(ds.get("PatientID", "")),
                "PatientBirthDate": str(ds.get("PatientBirthDate", "")),
            }
        for tag in _REPLACE_WITH_CASE_ID:
            if tag in ds:
                setattr(ds, tag, case_id)
        for tag in _BLANK:
            if tag in ds:
                setattr(ds, tag, "")
        ds.remove_private_tags()
        for tag in _UID_TAGS:
            old = str(getattr(ds, tag, "")) or None
            if old:
                uid_map.setdefault(old, generate_uid())
                setattr(ds, tag, uid_map[old])
        if hasattr(ds, "file_meta"):
            ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
        ds.PatientIdentityRemoved = "YES"
        ds.DeidentificationMethod = "coder3d basic profile subset"
        pydicom.dcmwrite(dst / f"{count:05d}.dcm", ds, enforce_file_format=True)
        count += 1
    return {"files": count, "identity": identity}
