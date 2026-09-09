import json
import re
import zipfile
from pathlib import Path

import pytest
import trimesh
from coder3d_print import project

TEMPLATE_SETTINGS = {
    "printer_settings_id": "Bambu Lab X2D 0.4 nozzle",
    "print_settings_id": "0.20mm Standard @BBL X2D",
    "filament_settings_id": ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
    "printer_model": "Bambu Lab X2D",
}

MAIN_MODEL = """<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter">
 <resources><object id="2" type="model"/></resources>
 <build>
  <item objectid="2" transform="0.5 0 0 0 0.5 0 0 0 0.5 10 20 1" printable="1"/>
 </build>
</model>
"""


def write_template(path: Path, objects: int = 1) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(project.MAIN_MODEL_ENTRY, MAIN_MODEL)
        for i in range(objects):
            z.writestr(f"3D/Objects/Cube_{i + 1}.model",
                       '<?xml version="1.0"?><model><resources><object id="1" type="model"><mesh/></object></resources></model>')
        z.writestr(project.SETTINGS_ENTRY, json.dumps(TEMPLATE_SETTINGS))
        z.writestr(project.MODEL_SETTINGS_ENTRY, "<config/>")
        z.writestr("Metadata/plate_1.png", b"stale-thumbnail")
    return path


def test_validate_template_reports_what_the_operator_chose(tmp_path):
    info = project.validate_template(write_template(tmp_path / "t.3mf"))
    assert info["printer"] == "Bambu Lab X2D 0.4 nozzle"
    assert info["process"] == "0.20mm Standard @BBL X2D"
    assert info["object_entry"] == "3D/Objects/Cube_1.model"


def test_template_must_be_a_real_project(tmp_path):
    plain = tmp_path / "plain.3mf"
    with zipfile.ZipFile(plain, "w") as z:
        z.writestr(project.MAIN_MODEL_ENTRY, MAIN_MODEL)
    with pytest.raises(project.TemplateInvalid, match="not a Bambu project template"):
        project.validate_template(plain)


def test_template_with_several_objects_is_rejected(tmp_path):
    """Which object would our mesh replace? Refuse rather than guess."""
    with pytest.raises(project.TemplateInvalid, match="exactly one"):
        project.validate_template(write_template(tmp_path / "multi.3mf", objects=3))


def test_mesh_object_xml_carries_every_vertex_and_face():
    box = trimesh.creation.box(extents=(10, 20, 30))
    xml = project.mesh_object_xml(box, object_id="7")
    assert xml.count("<vertex ") == len(box.vertices)
    assert xml.count("<triangle ") == len(box.faces)
    assert '<object id="7" type="model">' in xml


def test_place_on_plate_sets_identity_rotation_and_centres_the_part():
    placed = project.place_on_plate(MAIN_MODEL, (128.0, 128.0), height=31.0)
    transform = re.search(r'transform="([^"]+)"', placed).group(1)
    assert transform == "1 0 0 0 1 0 0 0 1 128 128 15.5"
    assert "0.5 0 0" not in placed  # the template's own scaling is gone


def test_build_from_template_swaps_geometry_and_keeps_settings(tmp_path):
    template = write_template(tmp_path / "t.3mf")
    mesh_path = tmp_path / "part.stl"
    trimesh.creation.box(extents=(40, 50, 60)).export(mesh_path)

    result = project.build_from_template(template, mesh_path, tmp_path / "out.3mf")
    assert result["size_mm"] == [40.0, 50.0, 60.0]
    assert result["printer"] == "Bambu Lab X2D 0.4 nozzle"

    with zipfile.ZipFile(tmp_path / "out.3mf") as z:
        names = z.namelist()
        geometry = z.read("3D/Objects/Cube_1.model").decode("utf-8")
        settings = json.loads(z.read(project.SETTINGS_ENTRY).decode("utf-8"))
        main = z.read(project.MAIN_MODEL_ENTRY).decode("utf-8")
    assert geometry.count("<vertex ") == 8  # our box, not the template's empty mesh
    assert settings == TEMPLATE_SETTINGS      # the operator's print profile is untouched
    assert 'transform="1 0 0 0 1 0 0 0 1 128 128 30"' in main
    assert project.MODEL_SETTINGS_ENTRY in names
    # A thumbnail of the template's object would misrepresent the job.
    assert not any(n.endswith(".png") for n in names)


def test_mesh_is_centred_before_placement(tmp_path):
    """The build transform assumes a part centred on its own origin."""
    template = write_template(tmp_path / "t.3mf")
    mesh_path = tmp_path / "offset.stl"
    box = trimesh.creation.box(extents=(10, 10, 10))
    box.apply_translation((500, -300, 42))  # far from the origin
    box.export(mesh_path)

    project.build_from_template(template, mesh_path, tmp_path / "out.3mf")
    with zipfile.ZipFile(tmp_path / "out.3mf") as z:
        geometry = z.read("3D/Objects/Cube_1.model").decode("utf-8")
    coords = [float(v) for v in re.findall(r'x="([-\d.e]+)"', geometry)]
    assert max(abs(c) for c in coords) <= 5.001  # recentred on the origin
