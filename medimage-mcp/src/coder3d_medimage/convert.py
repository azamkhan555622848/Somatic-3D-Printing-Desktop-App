"""DICOM→NIfTI via the dcm2niix binary shipped by the pip package."""
import subprocess
import sys
from pathlib import Path

import pydicom


def _dcm2niix_exe() -> str:
    exe = Path(sys.executable).parent / "dcm2niix.exe"
    if not exe.is_file():
        raise FileNotFoundError(f"dcm2niix.exe not found beside {sys.executable}")
    return str(exe)


def dicom_to_nifti(dicom_dir: Path, out_dir: Path) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    before = set(out_dir.glob("*.nii.gz"))
    r = subprocess.run(
        [_dcm2niix_exe(), "-z", "y", "-f", "%p_%s", "-o", str(out_dir), str(dicom_dir)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600,
    )
    written = sorted(set(out_dir.glob("*.nii.gz")) - before)
    if not written:
        raise RuntimeError(f"dcm2niix produced no output: {r.stdout[-800:]} {r.stderr[-800:]}")
    return written


def series_metadata(dicom_dir: Path) -> dict:
    paths = [p for p in sorted(Path(dicom_dir).rglob("*")) if p.is_file()]
    slices = 0
    first = None
    for p in paths:
        try:
            ds = pydicom.dcmread(p, stop_before_pixels=True)
        except Exception:
            continue
        slices += 1
        first = first or ds
    if first is None:
        raise ValueError(f"no DICOM files in {dicom_dir}")
    return {
        "modality": str(first.get("Modality", "")),
        "slice_thickness_mm": float(first.get("SliceThickness", 0.0)),
        "pixel_spacing_mm": [float(v) for v in first.get("PixelSpacing", [0.0, 0.0])],
        "slices": slices,
    }
