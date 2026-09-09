from coder3d_print import report
from fixtures.make_fixture_3mf import GCODE, SLICE_INFO, write_fixture


def paths_of(layer: dict) -> list:
    """Point lists only, for the tests that do not care about feature type."""
    return [path["p"] for path in layer["paths"]]


def test_stats_come_from_slice_info(tmp_path):
    f = write_fixture(tmp_path / "job.gcode.3mf")
    stats = report.read_stats(f)
    assert stats["print_time_s"] == 4530
    assert stats["print_time_human"] == "1h 15m"
    assert stats["weight_g"] == 61.24
    assert stats["support_used"] is True
    assert stats["printer_model_id"] == "X2D"


def test_slots_are_zero_based_in_our_model(tmp_path):
    """slice_info numbers filaments from 1; the AMS UI and our mapping use 0."""
    stats = report.read_stats(write_fixture(tmp_path / "job.gcode.3mf"))
    assert [s["slot"] for s in stats["slots"]] == [0, 1]
    assert stats["slots"][0]["color"] == "#FF0000"
    assert stats["slots"][0]["used_g"] == 41.2


def test_print_time_under_an_hour_drops_the_hour_field(tmp_path):
    info = SLICE_INFO.replace('key="prediction" value="4530"', 'key="prediction" value="900"')
    stats = report.read_stats(write_fixture(tmp_path / "job.gcode.3mf", slice_info=info))
    assert stats["print_time_human"] == "15m"


def test_layer_preview_groups_moves_by_layer(tmp_path):
    preview = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf"))
    assert [round(l["z"], 2) for l in preview["layers"]] == [0.2, 0.4]
    assert paths_of(preview["layers"][0])[0][:2] == [[10.0, 10.0], [20.0, 10.0]]
    assert preview["truncated"] is False
    assert preview["layer_height_mm"] == 0.2


def test_layer_preview_caps_huge_jobs(tmp_path):
    preview = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf"), max_layers=1)
    assert len(preview["layers"]) == 1
    assert preview["truncated"] is True


def test_travel_moves_break_the_polyline(tmp_path):
    """A travel is the gap between two printed islands. Drawing through it
    paints a line across the plate that the printer never extrudes."""
    gcode = "\n".join([
        ";LAYER_CHANGE",
        ";Z:0.2",
        "G1 X0 Y0 F9000",       # travel: seeds the first polyline
        "G1 X10 Y0 E0.5",
        "G1 X40 Y40 F9000",     # travel: closes it, seeds the next
        "G1 X50 Y40 E0.5",
    ])
    layer = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf", gcode=gcode))["layers"][0]
    assert paths_of(layer) == [[[0.0, 0.0], [10.0, 0.0]], [[40.0, 40.0], [50.0, 40.0]]]


def test_retractions_are_not_extrusions_in_absolute_e_mode(tmp_path):
    """With M82 the E field is a running total, so a retraction still carries a
    positive E. Only a rise over the previous value is material on the plate."""
    gcode = "\n".join([
        "M82",
        ";LAYER_CHANGE",
        ";Z:0.2",
        "G1 X0 Y0 F9000",
        "G1 X10 Y0 E1.0",
        "G1 E0.2",              # retract - no motion, must not extend anything
        "G1 X30 Y0 F9000",      # travel while retracted
        "G1 X40 Y0 E1.5",
    ])
    layer = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf", gcode=gcode))["layers"][0]
    assert paths_of(layer) == [[[0.0, 0.0], [10.0, 0.0]], [[30.0, 0.0], [40.0, 0.0]]]


def test_dense_layers_are_decimated_but_keep_their_ends(tmp_path):
    moves = "\n".join(f"G1 X{i} Y0 E0.1" for i in range(100))
    gcode = f";LAYER_CHANGE\n;Z:0.2\nG1 X0 Y0 F9000\n{moves}\n"
    layer = report.layer_preview(
        write_fixture(tmp_path / "job.gcode.3mf", gcode=gcode), max_points_per_layer=10
    )["layers"][0]
    points = paths_of(layer)[0]
    assert len(points) <= 12
    assert points[0] == [0.0, 0.0]
    assert points[-1] == [99.0, 0.0]


def test_paths_carry_the_feature_that_printed_them(tmp_path):
    """An opaque blob of one colour is unreadable. Feature type is what turns
    the preview into something an operator can actually inspect."""
    gcode = "\n".join([
        ";LAYER_CHANGE",
        ";Z:0.2",
        "; FEATURE: Outer wall",
        "G1 X0 Y0 F9000",
        "G1 X10 Y0 E0.5",
        "; FEATURE: Sparse infill",
        "G1 X0 Y5 F9000",
        "G1 X10 Y5 E0.5",
        "; FEATURE: Outer wall",
        "G1 X0 Y9 F9000",
        "G1 X10 Y9 E0.5",
    ])
    preview = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf", gcode=gcode))
    assert preview["features"] == ["Outer wall", "Sparse infill"]
    assert [path["f"] for path in preview["layers"][0]["paths"]] == [0, 1, 0]


def test_a_feature_change_ends_the_current_path(tmp_path):
    """Without this the last wall segment and the first infill segment join
    into one run and get painted in a single colour."""
    gcode = "\n".join([
        ";LAYER_CHANGE",
        ";Z:0.2",
        "; FEATURE: Outer wall",
        "G1 X0 Y0 F9000",
        "G1 X10 Y0 E0.5",
        "; FEATURE: Sparse infill",   # no travel between the two runs
        "G1 X20 Y0 E0.5",
    ])
    layer = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf", gcode=gcode))["layers"][0]
    assert len(layer["paths"]) == 2
    assert layer["paths"][0]["f"] != layer["paths"][1]["f"]


def test_gcode_without_feature_comments_still_previews(tmp_path):
    preview = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf"))
    assert preview["features"] == ["Unknown"]
    assert all(path["f"] == 0 for layer in preview["layers"] for path in layer["paths"])


def test_missing_gcode_entry_is_an_empty_preview_not_a_crash(tmp_path):
    import zipfile

    path = tmp_path / "job.gcode.3mf"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Metadata/slice_info.config", SLICE_INFO)
    preview = report.layer_preview(path)
    assert preview["layers"] == []
    assert preview["truncated"] is False


def test_gcode_is_read_without_extracting_the_whole_entry(tmp_path):
    """A real plate_1.gcode runs to hundreds of MB; reading it into a string
    would spike the server's memory for every preview."""
    import inspect

    source = inspect.getsource(report.layer_preview) + inspect.getsource(report._iter_gcode_lines)
    assert ".read()" not in source
    assert "z.open(" in source or "archive.open(" in source


def test_result_json_errors_surface(tmp_path):
    """result.json is the CLI's real report channel - it is where a failed
    slice explains itself, since the GUI-subsystem binary logs nothing."""
    merged = report.merge_slice_result(
        {"ok": False, "returncode": 1},
        {"error": "the object is out of the printable area", "warning": []},
    )
    assert merged["ok"] is False
    assert "printable area" in merged["error"]


def test_a_successful_slice_is_not_read_as_an_error(tmp_path):
    """Observed against Bambu Studio 2.8: a clean slice reports
    error_string "Success." with return_code 0."""
    merged = report.merge_slice_result(
        {"ok": True, "returncode": 0},
        {"error_string": "Success.", "return_code": 0, "sliced_plates": [{"warning_message": ""}]},
    )
    assert merged["ok"] is True
    assert "error" not in merged
    assert merged["warnings"] == []


def test_the_slicers_return_code_outranks_the_process_exit_code(tmp_path):
    """The binary is a GUI-subsystem app; its exit status says only that it ran."""
    merged = report.merge_slice_result({"ok": True, "returncode": 0}, {"return_code": 3, "error_string": ""})
    assert merged["ok"] is False
    assert merged["error"] == "slicer returned 3"


def test_per_plate_warnings_are_collected(tmp_path):
    merged = report.merge_slice_result(
        {"ok": True, "returncode": 0},
        {"return_code": 0, "sliced_plates": [{"warning_message": "object too close to the edge"}]},
    )
    assert merged["warnings"] == ["object too close to the edge"]
    assert merged["ok"] is True


def test_result_json_carries_per_filament_grams(tmp_path):
    merged = report.merge_slice_result(
        {"ok": True, "returncode": 0},
        {"filaments": [{"id": "1", "used_g": "41.2", "type": "PLA"}], "warning": ["a warning"]},
    )
    assert merged["warnings"] == ["a warning"]
    assert merged["result"]["filaments"][0]["used_g"] == "41.2"


def test_unparsed_gcode_lines_do_not_stop_the_walk(tmp_path):
    gcode = ";LAYER_CHANGE\n;Z:0.2\nG1 X0 Y0 F9000\nG1 Xbroken Y0 E1\nG1 X10 Y0 E1\n"
    layer = report.layer_preview(write_fixture(tmp_path / "job.gcode.3mf", gcode=gcode))["layers"][0]
    assert paths_of(layer) == [[[0.0, 0.0], [10.0, 0.0]]]
