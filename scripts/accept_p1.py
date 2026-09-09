"""P1 scripted acceptance: runner -> artifacts -> mesh checks -> renders."""
import json, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASE = ROOT / "workspace" / "cases" / "demo"
CAD_PY = ROOT / "cad-mcp" / ".venv" / "Scripts" / "python.exe"
MESH_PY = ROOT / "mesh-mcp" / ".venv" / "Scripts" / "python.exe"

def sh(python, code):
    r = subprocess.run([str(python), "-c", code], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout

(CASE / "cad").mkdir(parents=True, exist_ok=True)
shutil.copy(ROOT / "cad-mcp" / "tests" / "fixtures" / "tube_rack.py", CASE / "cad" / "tube_rack.py")

# 1. runner produces artifacts
r = subprocess.run([str(CAD_PY), "-m", "coder3d_cad.run",
                    "--script", str(CASE / "cad" / "tube_rack.py")],
                   capture_output=True, text=True)
assert r.returncode == 0, r.stderr
m = json.loads(r.stdout)
for rel in m["outputs"].values():
    assert (CASE / rel).is_file(), f"missing {rel}"
assert m["watertight"] is True and m["error"] is None

# 2. mesh-mcp agrees it is printable-shaped
info = json.loads(sh(MESH_PY,
    f"import json; from coder3d_mesh.ops import mesh_info; "
    f"print(json.dumps(mesh_info(r'{CASE / 'meshes' / 'tube_rack.stl'}')))"))
assert info["watertight"] is True and info["units_suspect"] is False

# 3. agent eyes: renders exist
outs = json.loads(sh(MESH_PY,
    f"import json; from coder3d_mesh.render import render_views; "
    f"print(json.dumps(render_views(r'{CASE / 'meshes' / 'tube_rack.stl'}')))"))
assert len(outs) == 4 and all(Path(o).stat().st_size > 1000 for o in outs)

print("P1 SCRIPTED ACCEPTANCE: PASS")
