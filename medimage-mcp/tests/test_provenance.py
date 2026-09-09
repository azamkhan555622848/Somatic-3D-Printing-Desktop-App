import json
from pathlib import Path

from coder3d_medimage.provenance import append_entry, read_log


def test_append_creates_and_appends(tmp_path: Path):
    f = tmp_path / "input.bin"
    f.write_bytes(b"hello")
    e1 = append_entry(tmp_path, step="import", tool="medimage.import_dicom",
                      params={"n": 1}, inputs=[f], outputs=[])
    e2 = append_entry(tmp_path, step="segment", tool="medimage.segment",
                      params={}, inputs=[], outputs=[f])
    log = read_log(tmp_path)
    assert [e["step"] for e in log] == ["import", "segment"]
    assert e1["inputs"][0]["sha256"] == e2["outputs"][0]["sha256"]
    assert len(e1["inputs"][0]["sha256"]) == 64
    assert log[0]["tool_version"]  # package version recorded


def test_log_is_valid_json_after_many_appends(tmp_path: Path):
    for i in range(5):
        append_entry(tmp_path, step=f"s{i}", tool="t", params={}, inputs=[], outputs=[])
    data = json.loads((tmp_path / "provenance.json").read_text(encoding="utf-8"))
    assert len(data) == 5
