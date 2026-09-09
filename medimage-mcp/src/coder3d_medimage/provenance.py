"""Append-only provenance log. The file is machine-owned: permission.edit deny
in both configs means only tool code (this module) ever writes it."""
import hashlib
import json
from datetime import datetime, timezone
from importlib.metadata import version as pkg_version
from pathlib import Path


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_refs(paths: list[Path]) -> list[dict]:
    return [{"path": str(Path(p)), "sha256": _sha256(Path(p))} for p in paths]


def append_entry(case_dir: Path, *, step: str, tool: str, params: dict,
                 inputs: list[Path], outputs: list[Path]) -> dict:
    case_dir = Path(case_dir)
    case_dir.mkdir(parents=True, exist_ok=True)
    log_path = case_dir / "provenance.json"
    log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else []
    try:
        tool_version = pkg_version("coder3d-medimage")
    except Exception:
        tool_version = "dev"
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "step": step,
        "tool": tool,
        "tool_version": tool_version,
        "params": params,
        "inputs": _file_refs(inputs),
        "outputs": _file_refs(outputs),
    }
    log.append(entry)
    tmp = log_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(log, indent=2), encoding="utf-8")
    tmp.replace(log_path)
    return entry


def read_log(case_dir: Path) -> list[dict]:
    log_path = Path(case_dir) / "provenance.json"
    return json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else []
