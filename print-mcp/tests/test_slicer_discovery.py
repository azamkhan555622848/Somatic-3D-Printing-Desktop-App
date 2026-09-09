import json
from pathlib import Path

import pytest
from coder3d_print import slicer


def _profile_tree(root: Path) -> Path:
    """Mirror the real Bambu Studio layout, inheritance and template files included."""
    base = root / "resources" / "profiles" / "BBL"
    machine, process, filament = base / "machine", base / "process", base / "filament"
    for d in (machine, process, filament):
        d.mkdir(parents=True)

    (machine / "fdm_machine_common.json").write_text(
        json.dumps({"type": "machine", "printable_height": "250", "gcode_flavor": "marlin"}), encoding="utf-8")
    (machine / "fdm_bbl_3dp_002_common.json").write_text(
        json.dumps({"inherits": "fdm_machine_common", "printable_height": "261", "machine_max_speed_x": ["500"]}),
        encoding="utf-8")
    (machine / "Bambu Lab X2D 0.4 nozzle.json").write_text(
        json.dumps({
            "type": "machine", "name": "Bambu Lab X2D 0.4 nozzle", "inherits": "fdm_bbl_3dp_002_common",
            "from": "system", "printer_model": "Bambu Lab X2D", "nozzle_diameter": ["0.4", "0.4"],
        }), encoding="utf-8")
    (machine / "Bambu Lab X2D 0.2 nozzle.json").write_text(
        json.dumps({"inherits": "fdm_bbl_3dp_002_common", "nozzle_diameter": ["0.2"]}), encoding="utf-8")
    # These are gcode snippets, not printer definitions — they must never be picked.
    (machine / "Bambu Lab X2D 0.4 nozzle template machine_start_gcode.json").write_text("{}", encoding="utf-8")
    (machine / "Bambu Lab P1S 0.4 nozzle.json").write_text(json.dumps({"printer_model": "P1S"}), encoding="utf-8")

    (process / "fdm_process_common.json").write_text(
        json.dumps({"type": "process", "layer_height": "0.28", "sparse_infill_density": "10%"}), encoding="utf-8")
    (process / "0.20mm Standard @BBL X2D.json").write_text(
        json.dumps({
            "type": "process", "name": "0.20mm Standard @BBL X2D", "inherits": "fdm_process_common",
            "layer_height": "0.2", "compatible_printers": ["Bambu Lab X2D 0.4 nozzle"],
        }), encoding="utf-8")
    (process / "0.08mm High Quality @BBL X2D.json").write_text(
        json.dumps({"inherits": "fdm_process_common", "layer_height": "0.08"}), encoding="utf-8")

    (filament / "Bambu PLA Basic @BBL X2D 0.4 nozzle.json").write_text(
        json.dumps({"type": "filament", "name": "Bambu PLA Basic @BBL X2D 0.4 nozzle", "filament_type": ["PLA"]}),
        encoding="utf-8")
    (filament / "Bambu ABS @BBL X2D 0.4 nozzle.json").write_text(
        json.dumps({"type": "filament", "name": "Bambu ABS @BBL X2D 0.4 nozzle", "filament_type": ["ABS"]}),
        encoding="utf-8")
    # Sorts before the real PLA and its name contains "PLA @BBL" — the trap.
    (filament / "Bambu Support For PLA @BBL X2D 0.4 nozzle.json").write_text(
        json.dumps({"type": "filament", "name": "Bambu Support For PLA @BBL X2D 0.4 nozzle",
                    "filament_type": ["PLA"]}), encoding="utf-8")
    (filament / "Bambu PLA-CF @BBL X2D 0.4 nozzle.json").write_text(
        json.dumps({"type": "filament", "name": "Bambu PLA-CF @BBL X2D 0.4 nozzle", "filament_type": ["PLA-CF"]}),
        encoding="utf-8")
    return root


def test_env_override_wins(tmp_path, monkeypatch):
    exe = tmp_path / "bambu-studio.exe"
    exe.write_bytes(b"")
    monkeypatch.setenv("CODER3D_BAMBU_STUDIO", str(exe))
    assert slicer.find_bambu_studio() == exe


def test_missing_binary_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("CODER3D_BAMBU_STUDIO", str(tmp_path / "nope.exe"))
    assert slicer.find_bambu_studio() is None


def test_discovery_prefers_the_04_nozzle_and_skips_template_files(tmp_path):
    root = _profile_tree(tmp_path)
    found = slicer.find_x2d_profiles(root)
    assert found["machine"].name == "Bambu Lab X2D 0.4 nozzle.json"
    assert "template" not in found["machine"].name
    assert found["process"].name == "0.20mm Standard @BBL X2D.json"
    assert any("PLA Basic" in f.name for f in found["filaments"])


def test_discovery_raises_when_no_x2d(tmp_path):
    base = tmp_path / "resources" / "profiles" / "BBL"
    (base / "machine").mkdir(parents=True)
    (base / "machine" / "Bambu Lab P1S 0.4 nozzle.json").write_text("{}", encoding="utf-8")
    with pytest.raises(slicer.ProfilesMissing):
        slicer.find_x2d_profiles(tmp_path)


def test_resolve_profile_flattens_the_inherits_chain(tmp_path):
    """The CLI wants self-contained JSON; system profiles are three levels deep."""
    root = _profile_tree(tmp_path)
    machine = root / "resources" / "profiles" / "BBL" / "machine" / "Bambu Lab X2D 0.4 nozzle.json"
    flat = slicer.resolve_profile(machine)
    assert "inherits" not in flat
    assert flat["gcode_flavor"] == "marlin"          # from the grandparent
    assert flat["printable_height"] == "261"          # child overrides grandparent
    assert flat["nozzle_diameter"] == ["0.4", "0.4"]  # leaf wins
    assert flat["printer_model"] == "Bambu Lab X2D"


def test_materialize_writes_flat_profiles_to_disk(tmp_path):
    root = _profile_tree(tmp_path)
    found = slicer.find_x2d_profiles(root)
    out = tmp_path / "flat"
    ready = slicer.materialize_profiles(found, out)
    machine = json.loads(ready["machine"].read_text(encoding="utf-8"))
    assert "inherits" not in machine and machine["printable_height"] == "261"
    assert ready["machine"].parent == out
    process = json.loads(ready["process"].read_text(encoding="utf-8"))
    assert process["layer_height"] == "0.2"
    assert process["sparse_infill_density"] == "10%"  # inherited


def test_materialize_selects_filaments_by_material(tmp_path):
    root = _profile_tree(tmp_path)
    found = slicer.find_x2d_profiles(root)
    ready = slicer.materialize_profiles(found, tmp_path / "flat", materials=["ABS", "PLA"])
    names = [json.loads(f.read_text(encoding="utf-8"))["name"] for f in ready["filaments"]]
    assert names == ["Bambu ABS @BBL X2D 0.4 nozzle", "Bambu PLA Basic @BBL X2D 0.4 nozzle"]


def test_model_material_is_never_a_support_filament(tmp_path):
    """'Bambu Support For PLA' contains 'PLA @BBL'; picking it for the model
    body would print the part in support-interface material."""
    root = _profile_tree(tmp_path)
    found = slicer.find_x2d_profiles(root)
    picked = slicer.filament_for("PLA", found["filaments"])
    assert picked is not None and "Support" not in picked.name
    assert picked.name == "Bambu PLA Basic @BBL X2D 0.4 nozzle.json"


def test_support_material_can_be_requested_explicitly(tmp_path):
    root = _profile_tree(tmp_path)
    found = slicer.find_x2d_profiles(root)
    picked = slicer.filament_for("PLA", found["filaments"], support=True)
    assert picked is not None and "Support" in picked.name


def test_exact_material_beats_a_variant(tmp_path):
    root = _profile_tree(tmp_path)
    found = slicer.find_x2d_profiles(root)
    assert "PLA-CF" not in slicer.filament_for("PLA", found["filaments"]).name
    assert "GF" not in slicer.filament_for("ABS", found["filaments"]).name
