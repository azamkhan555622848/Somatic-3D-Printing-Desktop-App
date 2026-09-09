import json
from pathlib import Path

import numpy as np
from coder3d_medimage import segment
from conftest import write_sphere_mask


def _fake_runner(input_path, output_dir, task, fast, device, roi_subset):
    """Stands in for totalsegmentator: writes two masks."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    write_sphere_mask(Path(output_dir) / "liver.nii.gz", radius_mm=10.0)
    write_sphere_mask(Path(output_dir) / "spleen.nii.gz", radius_mm=5.0)


def test_backend_pick_forced(monkeypatch):
    monkeypatch.setenv("CODER3D_SEG_FORCE", "cpu")
    assert segment.pick_backend() == "cpu"


def test_backend_pick_server_when_no_cuda(monkeypatch):
    monkeypatch.delenv("CODER3D_SEG_FORCE", raising=False)
    monkeypatch.setenv("CODER3D_SEG_SERVER", "http://lab:8000")
    monkeypatch.setattr(segment, "_cuda_available", lambda: False)
    assert segment.pick_backend() == "server"


def test_run_segmentation_writes_labels(sphere_mask, tmp_path, monkeypatch):
    monkeypatch.delenv("CODER3D_SEG_SERVER", raising=False)
    result = segment.run_segmentation(sphere_mask, tmp_path, structures=["liver", "spleen"],
                                      backend="cpu", runner=_fake_runner)
    labels = json.loads(Path(result["labels"]).read_text(encoding="utf-8"))
    assert set(labels) == {"liver", "spleen"}
    expected_ml = 4 / 3 * np.pi * 10 ** 3 / 1000.0
    assert abs(labels["liver"]["volume_ml"] - expected_ml) / expected_ml < 0.05
    assert result["resolution"] == "fast-3mm"  # cpu backend implies fast mode


def test_mr_modality_uses_mr_task(sphere_mask, tmp_path):
    seen = {}

    def spy(input_path, output_dir, task, fast, device, roi_subset):
        seen["task"] = task
        _fake_runner(input_path, output_dir, task, fast, device, roi_subset)

    segment.run_segmentation(sphere_mask, tmp_path, modality="MR", backend="cpu", runner=spy)
    assert seen["task"] == "total_mr"
