"""TotalSegmentator behind a pluggable backend chain (spec §1 decisions):
local CUDA -> lab GPU server (de-identified NIfTI only) -> CPU fast 3mm.
License note: TotalSegmentator weights are free for research/education.
First real run downloads ~4.5GB of weights to ~/.totalsegmentator."""
import json
import os
import urllib.request
import zipfile
from pathlib import Path

import SimpleITK as sitk

from coder3d_medimage.provenance import append_entry


def _cuda_available() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def pick_backend() -> str:
    forced = os.environ.get("CODER3D_SEG_FORCE")
    if forced in {"cuda", "server", "cpu"}:
        return forced
    if _cuda_available():
        return "cuda"
    if os.environ.get("CODER3D_SEG_SERVER"):
        return "server"
    return "cpu"


def _totalsegmentator_runner(input_path, output_dir, task, fast, device, roi_subset):
    from totalsegmentator.python_api import totalsegmentator
    totalsegmentator(input=Path(input_path), output=Path(output_dir), task=task,
                     fast=fast, device=device, roi_subset=roi_subset)


def _server_runner(volume: Path, out_dir: Path, task: str, structures) -> None:
    """POST the de-identified NIfTI to the lab server; unpack the mask zip."""
    base = os.environ["CODER3D_SEG_SERVER"].rstrip("/")
    roi = ",".join(structures) if structures else ""
    req = urllib.request.Request(f"{base}/segment?task={task}&roi={roi}",
                                 data=Path(volume).read_bytes(),
                                 headers={"Content-Type": "application/octet-stream"})
    zpath = Path(out_dir) / "_masks.zip"
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=1800) as resp:
        zpath.write_bytes(resp.read())
    with zipfile.ZipFile(zpath) as z:
        z.extractall(out_dir)
    zpath.unlink()


def _volume_ml(mask_path: Path) -> float:
    img = sitk.ReadImage(str(mask_path))
    voxels = float((sitk.GetArrayFromImage(img) > 0).sum())
    sx, sy, sz = img.GetSpacing()
    return voxels * sx * sy * sz / 1000.0


def run_segmentation(volume: Path, case_dir: Path, structures: list[str] | None = None,
                     modality: str = "CT", backend: str | None = None, runner=None) -> dict:
    case_dir = Path(case_dir)
    backend = backend or pick_backend()
    task = "total_mr" if modality.upper() == "MR" else "total"
    fast = backend == "cpu"  # CPU gets the 3mm fast models, with the fact recorded
    out_dir = case_dir / "segmentations" / Path(volume).name.replace(".nii.gz", "").replace(".nii", "")

    if backend == "server":
        _server_runner(volume, out_dir, task, structures)
    else:
        run = runner or _totalsegmentator_runner
        device = "gpu" if backend == "cuda" else "cpu"
        try:
            run(input_path=volume, output_dir=out_dir, task=task, fast=fast,
                device=device, roi_subset=structures)
        except RuntimeError as e:  # CUDA OOM on the 6GB laptop card -> fast models
            if backend == "cuda" and "out of memory" in str(e).lower():
                fast = True
                run(input_path=volume, output_dir=out_dir, task=task, fast=True,
                    device="gpu", roi_subset=structures)
            else:
                raise

    masks = sorted(Path(out_dir).glob("*.nii.gz"))
    labels = {m.name.replace(".nii.gz", ""): {"file": m.name, "volume_ml": round(_volume_ml(m), 2)}
              for m in masks}
    labels_path = Path(out_dir) / "labels.json"
    labels_path.write_text(json.dumps(labels, indent=2), encoding="utf-8")
    resolution = "fast-3mm" if fast else "standard"
    append_entry(case_dir, step="segment", tool=f"medimage.segment[{backend}]",
                 params={"task": task, "structures": structures, "resolution": resolution},
                 inputs=[Path(volume)], outputs=[labels_path, *masks])
    return {"backend": backend, "resolution": resolution,
            "labels": str(labels_path), "structures": labels}
