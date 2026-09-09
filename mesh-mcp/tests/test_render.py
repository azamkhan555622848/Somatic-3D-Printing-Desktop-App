import trimesh
from pathlib import Path

def test_render_writes_pngs(tmp_path):
    from coder3d_mesh.render import render_views
    p = tmp_path / "box.stl"
    trimesh.creation.box(extents=(20, 10, 5)).export(p)
    outs = render_views(str(p), out_dir=str(tmp_path / "r"))
    assert len(outs) == 4
    for o in outs:
        f = Path(o)
        assert f.is_file() and f.stat().st_size > 1000, "png missing/empty"
