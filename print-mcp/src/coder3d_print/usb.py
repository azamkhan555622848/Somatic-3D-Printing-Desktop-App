"""Write a sliced job to a removable drive, and prove the bytes arrived.

This is the end of the lane. The lab X2D is not networked, so the file the
surgeon's model is printed from is the file on this stick — which makes an
unverified copy the one failure that reaches the patient. Every export hashes
the source, writes through a temp name, hashes what landed, and records both in
the case's provenance log.
"""
import ctypes
import hashlib
import shutil
import string
from pathlib import Path

from .provenance import append_entry

DRIVE_REMOVABLE = 2  # GetDriveTypeW
# The stick needs room for the file plus FAT slack; a copy that just fits is
# how a truncated job ends up listed on the printer.
HEADROOM_BYTES = 8 * 1024 * 1024


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def free_bytes(drive: str) -> int:
    try:
        return shutil.disk_usage(drive).free
    except OSError:
        return 0


def _volume_label(root: str) -> str:
    if not hasattr(ctypes, "windll"):
        return ""
    buffer = ctypes.create_unicode_buffer(261)
    try:
        ok = ctypes.windll.kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p(root), buffer, ctypes.sizeof(buffer),
            None, None, None, None, 0,
        )
    except OSError:
        return ""
    return buffer.value if ok else ""


def removable_drives() -> list[dict]:
    """Windows drive letters whose type is removable. Answers with an empty
    list off Windows or with nothing plugged in - never raises, because this
    is called just to populate a picker."""
    if not hasattr(ctypes, "windll"):
        return []
    found: list[dict] = []
    try:
        mask = ctypes.windll.kernel32.GetLogicalDrives()
    except OSError:
        return []
    for index, letter in enumerate(string.ascii_uppercase):
        if not mask & (1 << index):
            continue
        root = f"{letter}:\\"
        try:
            if ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(root)) != DRIVE_REMOVABLE:
                continue
        except OSError:
            continue
        free = free_bytes(root)
        if free == 0 and not Path(root).exists():
            continue  # an empty card reader slot
        found.append({"drive": root, "label": _volume_label(root), "free_gb": round(free / 1e9, 2)})
    return found


def export_job(gcode_3mf: Path, drive: str, case_dir: Path, subdir: str = "") -> dict:
    job = Path(gcode_3mf)
    root = Path(drive)
    if not job.is_file():
        return {"ok": False, "target": "", "sha256": "", "verified": False,
                "message": f"{job} does not exist - slice the job first."}
    if not root.is_dir():
        # Creating it would silently make a folder on the system disk and hand
        # back a path the printer will never see.
        return {"ok": False, "target": "", "sha256": "", "verified": False,
                "message": f"{drive} is not mounted. Insert the USB drive and try again."}

    size = job.stat().st_size
    available = free_bytes(str(root))
    if available < size + HEADROOM_BYTES:
        return {
            "ok": False, "target": "", "sha256": "", "verified": False,
            "message": f"Not enough space on {drive}: the job needs "
                       f"{size / 1e6:.1f} MB and only {available / 1e6:.1f} MB is free.",
        }

    target_dir = root / subdir if subdir else root
    target = target_dir / job.name
    tmp = target.with_name(target.name + ".partial")
    source_hash = sha256_file(job)
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(job, tmp)
        tmp.replace(target)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        return {"ok": False, "target": str(target), "sha256": source_hash, "verified": False,
                "message": f"Copy to {drive} failed: {exc}"}

    written_hash = sha256_file(target)
    verified = written_hash == source_hash
    if not verified:
        target.unlink(missing_ok=True)
        return {
            "ok": False, "target": str(target), "sha256": source_hash, "verified": False,
            "message": f"The copy on {drive} did not match the source and was removed. "
                       "The drive may be failing - try another one.",
        }

    append_entry(
        Path(case_dir),
        step="export_to_usb",
        tool="print.export_to_usb",
        params={"drive": str(drive), "subdir": subdir, "bytes": size},
        inputs=[job],
        outputs=[target],
    )
    return {
        "ok": True, "target": str(target), "sha256": source_hash, "verified": True,
        "message": f"Written to {drive} and verified ({size / 1e6:.1f} MB). "
                   f"Eject the drive, insert it into the X2D, and pick {job.name} on the printer.",
    }
