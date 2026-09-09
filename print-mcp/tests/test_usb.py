import hashlib
from pathlib import Path

import pytest
from coder3d_print import usb


def make_job(tmp_path: Path, size: int = 4096) -> Path:
    path = tmp_path / "finger.gcode.3mf"
    path.write_bytes(b"PK\x03\x04" + bytes(range(256)) * (size // 256))
    return path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_the_copy_is_byte_identical(tmp_path):
    job = make_job(tmp_path)
    drive = tmp_path / "E"
    drive.mkdir()
    result = usb.export_job(job, str(drive), tmp_path / "case")
    assert result["ok"] is True
    assert result["verified"] is True
    target = Path(result["target"])
    assert sha256(target) == sha256(job) == result["sha256"]


def test_an_existing_file_of_the_same_name_is_replaced(tmp_path):
    job = make_job(tmp_path)
    drive = tmp_path / "E"
    drive.mkdir()
    stale = drive / job.name
    stale.write_bytes(b"an older job")
    result = usb.export_job(job, str(drive), tmp_path / "case")
    assert Path(result["target"]).read_bytes() == job.read_bytes()


def test_insufficient_space_fails_before_writing_anything(tmp_path, monkeypatch):
    """Filling a stick and leaving a half-written file on it is worse than
    refusing: the printer would happily list the truncated job."""
    job = make_job(tmp_path)
    drive = tmp_path / "E"
    drive.mkdir()
    monkeypatch.setattr(usb, "free_bytes", lambda _drive: 10)
    result = usb.export_job(job, str(drive), tmp_path / "case")
    assert result["ok"] is False
    assert "space" in result["message"].lower()
    assert list(drive.iterdir()) == []


def test_a_missing_drive_is_reported_not_created(tmp_path):
    job = make_job(tmp_path)
    result = usb.export_job(job, str(tmp_path / "not-mounted"), tmp_path / "case")
    assert result["ok"] is False
    assert not (tmp_path / "not-mounted").exists()


def test_the_message_names_the_drive_to_eject(tmp_path):
    job = make_job(tmp_path)
    drive = tmp_path / "E"
    drive.mkdir()
    result = usb.export_job(job, str(drive), tmp_path / "case")
    assert str(drive) in result["message"]
    assert "eject" in result["message"].lower()


def test_a_subdir_is_created_on_the_stick(tmp_path):
    job = make_job(tmp_path)
    drive = tmp_path / "E"
    drive.mkdir()
    result = usb.export_job(job, str(drive), tmp_path / "case", subdir="cases/hand")
    assert Path(result["target"]).parent == drive / "cases" / "hand"


def test_no_partial_file_survives_a_failed_copy(tmp_path, monkeypatch):
    job = make_job(tmp_path)
    drive = tmp_path / "E"
    drive.mkdir()

    def boom(*_args, **_kwargs):
        raise OSError("device removed")

    monkeypatch.setattr(usb.shutil, "copyfile", boom)
    result = usb.export_job(job, str(drive), tmp_path / "case")
    assert result["ok"] is False
    assert list(drive.iterdir()) == []


def test_the_export_is_recorded_in_provenance(tmp_path):
    from coder3d_print import provenance

    job = make_job(tmp_path)
    drive = tmp_path / "E"
    drive.mkdir()
    case = tmp_path / "case"
    result = usb.export_job(job, str(drive), case)
    entry = provenance.read_log(case)[-1]
    assert entry["step"] == "export_to_usb"
    assert entry["outputs"][0]["sha256"] == result["sha256"]


def test_removable_drives_returns_a_list_without_raising():
    """No stick has to be plugged in for this to answer."""
    drives = usb.removable_drives()
    assert isinstance(drives, list)
    for d in drives:
        assert {"drive", "label", "free_gb"} <= set(d)
