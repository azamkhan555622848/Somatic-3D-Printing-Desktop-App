from pathlib import Path
import shutil

FIXTURE = Path(__file__).parent / "fixtures" / "tube_rack.py"

def test_tools_registered():
    from coder3d_cad.server import cad_run, cad_params
    assert cad_run is not None and cad_params is not None

def test_cad_params_reads_schema(tmp_path):
    (tmp_path / "cad").mkdir()
    shutil.copy(FIXTURE, tmp_path / "cad" / "tube_rack.py")
    from coder3d_cad.server import cad_params
    fn = getattr(cad_params, "fn", cad_params)
    schema = fn(str(tmp_path / "cad" / "tube_rack.py"))
    assert schema["tube_diameter"]["default"] == 13.0
