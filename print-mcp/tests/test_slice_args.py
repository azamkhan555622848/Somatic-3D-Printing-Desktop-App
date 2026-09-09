from pathlib import Path

from coder3d_print import slicer

PROFILES = {"machine": Path("m.json"), "process": Path("p.json"), "filaments": []}


def test_args_follow_the_documented_shape():
    args = slicer.build_slice_args(Path("part.stl"), Path("out.gcode.3mf"), PROFILES)
    assert args[args.index("--load-settings") + 1] == "m.json;p.json"
    assert args[args.index("--export-3mf") + 1] == "out.gcode.3mf"
    assert args[args.index("--slice") + 1] == "1"
    assert "--allow-newer-file" in args      # shipped profiles can be newer than the CLI
    assert "--skip-useless-pick" in args     # headless thumbnails are blank anyway
    assert args[-1] == "part.stl"            # the model comes last


def test_filaments_are_semicolon_joined_in_slot_order():
    profiles = {**PROFILES, "filaments": [Path("red.json"), Path("white.json")]}
    args = slicer.build_slice_args(Path("part.stl"), Path("o.3mf"), profiles)
    assert args[args.index("--load-filaments") + 1] == "red.json;white.json"


def test_no_filament_flag_when_none_selected():
    assert "--load-filaments" not in slicer.build_slice_args(Path("a.stl"), Path("o.3mf"), PROFILES)


def test_slicer_side_timeout_is_passed_through():
    args = slicer.build_slice_args(Path("a.stl"), Path("o.3mf"), PROFILES, timeout_s=900)
    assert args[args.index("--mstpp") + 1] == "900"


def test_orientation_and_arrange_are_opt_in():
    """Medical parts are oriented deliberately; the slicer must not re-pose them
    unless asked."""
    plain = slicer.build_slice_args(Path("a.stl"), Path("o.3mf"), PROFILES)
    assert "--orient" not in plain and "--arrange" not in plain
    posed = slicer.build_slice_args(Path("a.stl"), Path("o.3mf"), PROFILES, arrange=True, orient=True)
    assert posed[posed.index("--arrange") + 1] == "1"
    assert "--orient" in posed


def test_a_project_is_sliced_without_external_presets():
    """A project carries its own machine, filament and process; adding
    --load-settings on top is the combination that the CLI rejects."""
    args = slicer.build_project_slice_args(Path("job.3mf"), Path("out.gcode.3mf"))
    assert "--load-settings" not in args
    assert "--load-filaments" not in args
    assert args[args.index("--export-3mf") + 1] == "out.gcode.3mf"
    assert args[args.index("--slice") + 1] == "1"
    assert args[-1] == "job.3mf"


def test_project_slice_passes_the_plate_and_timeout():
    args = slicer.build_project_slice_args(Path("j.3mf"), Path("o.3mf"), plate=2, timeout_s=600)
    assert args[args.index("--slice") + 1] == "2"
    assert args[args.index("--mstpp") + 1] == "600"
