import json
import subprocess
import sys
import time
from pathlib import Path

from coder3d_print import server

TOOLS = {
    "printer_profiles", "list_print_templates", "slice_model",
    "print_report", "list_usb_drives", "export_to_usb",
}


def test_every_tool_is_exposed():
    assert TOOLS <= {name for name in dir(server) if not name.startswith("_")}


def test_the_module_imports_without_pulling_in_the_heavy_stack():
    """P2 lesson: an 18 s import blocks opencode's instance bootstrap and empties
    the MCP list for EVERY project, not just this one."""
    started = time.monotonic()
    proc = subprocess.run(
        [sys.executable, "-c", "import coder3d_print.server"],
        capture_output=True, text=True, timeout=60,
    )
    elapsed = time.monotonic() - started
    assert proc.returncode == 0, proc.stderr
    assert elapsed < 5, f"importing the server took {elapsed:.1f}s"


def test_trimesh_is_not_imported_at_module_scope():
    source = Path(server.__file__).read_text(encoding="utf-8")
    header = source.split("@mcp.tool", 1)[0]
    assert "import trimesh" not in header
    assert "from coder3d_print import project" not in header


def test_export_refuses_a_job_with_no_gate_verdict(tmp_path):
    """The stick is the last place a wrong file can still be stopped."""
    job = tmp_path / "job.gcode.3mf"
    job.write_bytes(b"PK\x03\x04")
    result = server.export_to_usb(str(job), str(tmp_path), str(tmp_path / "case"))
    assert result["ok"] is False
    assert "Print Gate" in result["message"]


def test_export_refuses_a_job_whose_gate_failed(tmp_path):
    case = tmp_path / "case"
    qa = case / "prints" / "qa"
    qa.mkdir(parents=True)
    job = tmp_path / "job.gcode.3mf"
    job.write_bytes(b"PK\x03\x04")
    (qa / "job.gate.json").write_text(json.dumps({
        "passed": False,
        "checks": {"machine": {"passed": False}, "plate_fit": {"passed": True}},
    }), encoding="utf-8")
    result = server.export_to_usb(str(job), str(tmp_path), str(case))
    assert result["ok"] is False
    assert "machine" in result["message"]


def test_export_proceeds_when_the_gate_passed(tmp_path):
    case = tmp_path / "case"
    qa = case / "prints" / "qa"
    qa.mkdir(parents=True)
    job = tmp_path / "job.gcode.3mf"
    job.write_bytes(b"PK\x03\x04" + b"\0" * 1024)
    (qa / "job.gate.json").write_text(json.dumps({"passed": True, "checks": {}}), encoding="utf-8")
    drive = tmp_path / "E"
    drive.mkdir()
    result = server.export_to_usb(str(job), str(drive), str(case))
    assert result["ok"] is True
    assert Path(result["target"]).is_file()


def test_templates_report_the_export_step_when_none_exist(tmp_path):
    result = server.list_print_templates(str(tmp_path))
    assert result["templates"] == []
    assert "Export project" in result["hint"]
    assert "X2D" in result["hint"]
