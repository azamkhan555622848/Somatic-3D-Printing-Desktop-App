import json
from pathlib import Path

import pytest
import trimesh
from coder3d_print import gate
from fixtures.make_fixture_3mf import SLICE_INFO, write_fixture

X2D_SETTINGS = json.dumps({
    "printer_model": "Bambu Lab X2D",
    "printer_settings_id": "Bambu Lab X2D 0.4 nozzle",
    "print_settings_id": "0.20mm Standard @BBL X2D",
})


_counter = iter(range(1, 10_000))


def make_job(tmp_path: Path, slice_info: str = SLICE_INFO, settings: str = X2D_SETTINGS) -> Path:
    """Each call gets its own filename: two fixtures sharing a path in one test
    means the second silently becomes the first."""
    import zipfile

    n = next(_counter)
    path = write_fixture(tmp_path / f"job{n}.gcode.3mf", slice_info=slice_info)
    # write_fixture leaves project_settings empty; the gate reads the machine
    # out of it, so it is filled in here.
    repacked = tmp_path / f"job{n}.repack.3mf"
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(repacked, "w") as dst:
        for name in src.namelist():
            dst.writestr(name, settings if name.endswith("project_settings.config") else src.read(name))
    repacked.replace(path)
    return path


def make_mesh(tmp_path: Path, extents=(20.0, 30.0, 40.0)) -> Path:
    path = tmp_path / f"part{next(_counter)}.stl"
    trimesh.creation.box(extents=extents).export(str(path))
    return path


def run(tmp_path: Path, **kwargs) -> dict:
    args = {
        "case_dir": tmp_path / "case",
        "support_strategy": "none",
        "material": "PLA",
        "intended_use": "display",
    }
    args.update(kwargs)
    args.setdefault("gcode_3mf", make_job(tmp_path))
    args.setdefault("mesh_path", make_mesh(tmp_path))
    return gate.print_gate(**args)


def test_a_clean_job_passes_every_check(tmp_path):
    info = SLICE_INFO.replace('key="support_used" value="true"', 'key="support_used" value="false"')
    result = run(tmp_path, gcode_3mf=make_job(tmp_path, slice_info=info))
    assert result["passed"] is True, result["checks"]
    assert set(result["checks"]) == {
        "slicer_ok", "support_strategy", "plate_fit", "material_fit", "stats_attached", "machine",
    }


def test_a_project_that_was_never_sliced_fails_slicer_ok(tmp_path):
    import zipfile

    path = tmp_path / "unsliced.3mf"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Metadata/project_settings.config", X2D_SETTINGS)
    result = run(tmp_path, gcode_3mf=path)
    assert result["passed"] is False
    assert result["checks"]["slicer_ok"]["passed"] is False


def test_an_unstated_support_strategy_fails(tmp_path):
    """"auto" means nobody decided. On an anatomical model the support choice
    changes what the surface looks like where it mattered most."""
    for strategy in (None, "auto", "", "maybe"):
        result = run(tmp_path, support_strategy=strategy)
        assert result["checks"]["support_strategy"]["passed"] is False, strategy


def test_claiming_no_support_while_the_slicer_used_it_fails(tmp_path):
    result = run(tmp_path, support_strategy="none")  # fixture has support_used=true
    assert result["checks"]["support_strategy"]["passed"] is False
    assert "support" in result["checks"]["support_strategy"]["detail"].lower()


def test_a_declared_support_strategy_passes(tmp_path):
    result = run(tmp_path, support_strategy="same-material")
    assert result["checks"]["support_strategy"]["passed"] is True


def test_a_mesh_larger_than_the_plate_fails(tmp_path):
    result = run(tmp_path, mesh_path=make_mesh(tmp_path, extents=(300.0, 20.0, 20.0)))
    assert result["checks"]["plate_fit"]["passed"] is False


def test_the_aux_nozzle_narrows_the_usable_plate(tmp_path):
    """Dual-nozzle mode loses X to the second toolhead: 235.5 mm, not 256."""
    mesh = make_mesh(tmp_path, extents=(250.0, 20.0, 20.0))
    assert run(tmp_path, mesh_path=mesh)["checks"]["plate_fit"]["passed"] is True
    narrowed = run(tmp_path, mesh_path=mesh, use_aux_nozzle=True, support_strategy="aux-nozzle")
    assert narrowed["checks"]["plate_fit"]["passed"] is False


def test_plate_fit_does_not_assume_the_part_can_be_turned(tmp_path):
    """The slicer runs with --arrange and --orient off, so a part that would
    only fit sideways does not fit."""
    mesh = make_mesh(tmp_path, extents=(20.0, 250.0, 20.0))
    result = run(tmp_path, mesh_path=mesh, use_aux_nozzle=True, support_strategy="aux-nozzle")
    assert result["checks"]["plate_fit"]["passed"] is True  # 250 in Y is within 256
    tall = make_mesh(tmp_path, extents=(20.0, 20.0, 258.0))
    assert run(tmp_path, mesh_path=tall, use_aux_nozzle=True,
               support_strategy="aux-nozzle")["checks"]["plate_fit"]["passed"] is False


def test_a_prosthetic_in_pla_fails_material_fit(tmp_path):
    """PLA creeps under load and softens in a car or an autoclave; a worn
    prosthesis is not a display model."""
    result = run(tmp_path, material="PLA", intended_use="prosthetic")
    assert result["checks"]["material_fit"]["passed"] is False


def test_a_prosthetic_in_a_chamber_material_passes_material_fit(tmp_path):
    for material in ("ABS", "ASA", "PA-CF"):
        result = run(tmp_path, material=material, intended_use="prosthetic")
        assert result["checks"]["material_fit"]["passed"] is True, material


def test_display_anatomy_in_pla_passes_material_fit(tmp_path):
    assert run(tmp_path, material="PLA", intended_use="display")["checks"]["material_fit"]["passed"] is True


def test_an_unstated_intended_use_fails_rather_than_guessing(tmp_path):
    result = run(tmp_path, intended_use=None)
    assert result["checks"]["material_fit"]["passed"] is False


def test_missing_stats_fail_stats_attached(tmp_path):
    info = SLICE_INFO.replace('value="4530"', 'value="0"').replace('value="61.24"', 'value="0"')
    result = run(tmp_path, gcode_3mf=make_job(tmp_path, slice_info=info))
    assert result["checks"]["stats_attached"]["passed"] is False


def test_a_file_sliced_for_another_printer_fails(tmp_path):
    """The whole reason this check exists: an A1 project slices cleanly and
    produces a plausible file the X2D should never be given."""
    a1 = json.dumps({"printer_model": "Bambu Lab A1", "printer_settings_id": "Bambu Lab A1 0.4 nozzle"})
    result = run(tmp_path, gcode_3mf=make_job(tmp_path, settings=a1))
    assert result["passed"] is False
    assert result["checks"]["machine"]["passed"] is False
    assert "A1" in result["checks"]["machine"]["detail"]


def test_the_verdict_is_written_where_only_tool_code_may_write(tmp_path):
    case = tmp_path / "case"
    result = run(tmp_path, case_dir=case)
    report = Path(result["report"])
    assert report.parent == case / "prints" / "qa"
    assert json.loads(report.read_text(encoding="utf-8"))["passed"] == result["passed"]


def test_the_gate_appends_to_provenance(tmp_path):
    from coder3d_print import provenance

    case = tmp_path / "case"
    run(tmp_path, case_dir=case)
    log = provenance.read_log(case)
    assert log[-1]["step"] == "print_gate"
    assert log[-1]["outputs"][0]["sha256"]


def test_a_failed_gate_still_writes_its_report(tmp_path):
    """An operator has to be able to read WHY a job was refused."""
    case = tmp_path / "case"
    result = run(tmp_path, case_dir=case, material="PLA", intended_use="prosthetic")
    assert result["passed"] is False
    assert Path(result["report"]).is_file()
