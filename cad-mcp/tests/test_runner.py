import json, shutil, subprocess, sys
from pathlib import Path
import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "tube_rack.py"

@pytest.fixture()
def case(tmp_path):
    (tmp_path / "cad").mkdir()
    shutil.copy(FIXTURE, tmp_path / "cad" / "tube_rack.py")
    return tmp_path

def test_run_script_produces_outputs_and_manifest(case):
    from coder3d_cad.runner import run_script
    m = run_script(str(case / "cad" / "tube_rack.py"))
    assert m["error"] is None
    for key, rel in m["outputs"].items():
        assert (case / rel).is_file(), f"{key} missing"
    assert m["outputs"]["stl"] == "meshes/tube_rack.stl"
    assert m["outputs"]["step"] == "cad/tube_rack.step"
    assert (case / "cad" / "tube_rack.manifest.json").is_file()
    assert m["watertight"] is True
    assert all(v > 0 for v in m["bbox_mm"])

def test_param_override_changes_geometry(case):
    from coder3d_cad.runner import run_script
    small = run_script(str(case / "cad" / "tube_rack.py"), {"cols": 2})
    big   = run_script(str(case / "cad" / "tube_rack.py"), {"cols": 8})
    assert big["bbox_mm"][0] > small["bbox_mm"][0]
    assert big["params"]["cols"]["value"] == 8
    assert big["params"]["cols"]["default"] == 4

def test_out_of_range_param_rejected(case):
    from coder3d_cad.runner import run_script
    m = run_script(str(case / "cad" / "tube_rack.py"), {"tube_diameter": 999})
    assert m["error"] is not None and "tube_diameter" in m["error"]

def test_cli_prints_manifest(case):
    r = subprocess.run(
        [sys.executable, "-m", "coder3d_cad.run",
         "--script", str(case / "cad" / "tube_rack.py"),
         "--params-json", json.dumps({"rows": 2})],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    m = json.loads(r.stdout)
    assert m["params"]["rows"]["value"] == 2


def test_reuse_takes_last_built_values_from_the_manifest(case):
    """A source edit must not silently revert the part to defaults."""
    from coder3d_cad.runner import run_script
    run_script(str(case / "cad" / "tube_rack.py"), {"rows": 5, "tube_diameter": 18})
    again = run_script(str(case / "cad" / "tube_rack.py"), None, reuse=True)
    assert again["params"]["rows"]["value"] == 5
    assert again["params"]["tube_diameter"]["value"] == 18


def test_reuse_without_a_manifest_falls_back_to_defaults(case):
    from coder3d_cad.runner import run_script
    m = run_script(str(case / "cad" / "tube_rack.py"), None, reuse=True)
    assert m["error"] is None
    assert m["params"]["rows"]["value"] == m["params"]["rows"]["default"]


def test_reuse_drops_values_the_script_no_longer_accepts(case):
    """The script can change under a stored manifest; reuse must not hard-fail."""
    from coder3d_cad.runner import run_script
    script = case / "cad" / "tube_rack.py"
    run_script(str(script), {"rows": 5})
    manifest_path = case / "cad" / "tube_rack.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["params"]["obsolete"] = {"default": 1, "min": 0, "max": 2, "step": 1, "unit": "", "value": 2}
    manifest["params"]["tube_diameter"]["value"] = 9999  # now out of range
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    m = run_script(str(script), None, reuse=True)
    assert m["error"] is None
    assert m["params"]["rows"]["value"] == 5
    assert m["params"]["tube_diameter"]["value"] == m["params"]["tube_diameter"]["default"]
    assert "obsolete" not in m["params"]


def test_explicit_unknown_param_still_errors(case):
    """Reuse is forgiving; an explicit call with a typo must still fail loudly."""
    from coder3d_cad.runner import run_script
    m = run_script(str(case / "cad" / "tube_rack.py"), {"rowz": 5})
    assert m["error"] is not None and "rowz" in m["error"]


def test_3mf_export_carries_the_same_geometry_in_millimeters(case):
    """Bambu Studio opens .3mf natively with explicit units; every build ships
    one beside the STL so the slicer never has to guess millimeters."""
    import zipfile
    from build123d import Mesher
    from coder3d_cad.runner import run_script
    m = run_script(str(case / "cad" / "tube_rack.py"))
    assert m["error"] is None
    assert m["outputs"]["3mf"] == "meshes/tube_rack.3mf"
    path = case / m["outputs"]["3mf"]
    with zipfile.ZipFile(path) as z:  # a .3mf is a zip around a model XML
        name = next(n for n in z.namelist() if n.endswith(".model"))
        assert 'unit="millimeter"' in z.read(name).decode("utf-8", "replace")
    shapes = Mesher().read(str(path))
    bbox = shapes[0].bounding_box()
    for recorded, actual in zip(m["bbox_mm"], (bbox.size.X, bbox.size.Y, bbox.size.Z)):
        assert abs(recorded - actual) < 0.1, "3mf geometry disagrees with the manifest"


def test_concurrent_runs_leave_consistent_artifacts(case):
    """Two writers (app rebuild + agent cad_run) must not interleave: the mesh
    on disk always matches the manifest that describes it."""
    import trimesh
    script = str(case / "cad" / "tube_rack.py")
    procs = [
        subprocess.Popen(
            [sys.executable, "-m", "coder3d_cad.run", "--script", script,
             "--params-json", json.dumps(params)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for params in ({"cols": 2}, {"cols": 8})
    ]
    for p in procs:
        p.wait(timeout=300)
    manifest = json.loads((case / "cad" / "tube_rack.manifest.json").read_text(encoding="utf-8"))
    mesh = trimesh.load(str(case / "meshes" / "tube_rack.stl"))
    assert manifest["error"] is None
    for recorded, actual in zip(manifest["bbox_mm"], mesh.bounding_box.extents):
        assert abs(recorded - actual) < 0.01, "manifest describes a different mesh than the one on disk"
