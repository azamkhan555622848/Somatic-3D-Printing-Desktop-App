"""Build a sliceable Bambu project by putting our mesh into a template project.

Why a template, rather than composing settings ourselves:

* `--load-settings` with exported preset JSON does not work — the CLI answers
  "The input preset file is invalid and can not be parsed", and several
  variants crash it outright (verified 2026-08-14 against Bambu Studio 2.x).
* Composing `project_settings.config` by flattening the shipped system profiles
  also crashes it. The system profiles store per-variant ARRAYS that the GUI
  resolves down to the selected printer variant (66 keys arrive as 6-element
  lists, and `name` becomes a list), so a naive flatten produces a file the
  slicer cannot interpret. Reimplementing that resolution would be guesswork,
  and a subtly wrong machine definition slices a plausible file that ruins a
  print.
* What does work, reliably, is a complete project authored by Bambu Studio
  itself: geometry, `project_settings.config`, and `model_settings.config`.
  Verified: the shipped calibration projects slice with return_code 0.

So the lab exports one template project per material/process combination from
the GUI (printer, filament and process selected), and we swap our mesh into it.
The print profile stays exactly what the operator chose and can audit.
"""
import re
import zipfile
from pathlib import Path

SETTINGS_ENTRY = "Metadata/project_settings.config"
MODEL_SETTINGS_ENTRY = "Metadata/model_settings.config"
MAIN_MODEL_ENTRY = "3D/3dmodel.model"

_OBJECT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="{object_id}" type="model">
   <mesh>
    <vertices>
{vertices}
    </vertices>
    <triangles>
{triangles}
    </triangles>
   </mesh>
  </object>
 </resources>
</model>
"""


class TemplateInvalid(RuntimeError):
    pass


def object_entries(names: list[str]) -> list[str]:
    return [n for n in names if n.startswith("3D/Objects/") and n.endswith(".model")]


def validate_template(path: Path) -> dict:
    """A usable template is a Bambu project with settings and exactly one object."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        objects = object_entries(names)
        missing = [e for e in (SETTINGS_ENTRY, MODEL_SETTINGS_ENTRY, MAIN_MODEL_ENTRY) if e not in names]
        if missing:
            raise TemplateInvalid(
                f"{path.name} is not a Bambu project template (missing {', '.join(missing)}). "
                "Export one from Bambu Studio with File > Export > Export project."
            )
        if len(objects) != 1:
            raise TemplateInvalid(
                f"{path.name} holds {len(objects)} objects; the template must contain exactly one, "
                "so the mesh it is replaced with is unambiguous."
            )
        import json

        settings = json.loads(z.read(SETTINGS_ENTRY).decode("utf-8"))
    return {
        "object_entry": objects[0],
        "printer": settings.get("printer_settings_id", ""),
        "process": settings.get("print_settings_id", ""),
        "filaments": settings.get("filament_settings_id", []),
        "printer_model": settings.get("printer_model", ""),
    }


def mesh_object_xml(mesh, object_id: str = "1") -> str:
    """Bambu keeps geometry in its own part file, in plain 3MF core XML."""
    vertices = "\n".join(
        f'     <vertex x="{x:.6g}" y="{y:.6g}" z="{z:.6g}"/>' for x, y, z in mesh.vertices
    )
    triangles = "\n".join(
        f'     <triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in mesh.faces
    )
    return _OBJECT_XML.format(object_id=object_id, vertices=vertices, triangles=triangles)


def _object_id_of(object_xml: bytes) -> str:
    match = re.search(rb'<object\s+id="([^"]+)"', object_xml)
    return match.group(1).decode() if match else "1"


def place_on_plate(main_model: str, bed_center: tuple[float, float], height: float) -> str:
    """Rewrite the build item so our mesh sits centred on the bed.

    The mesh is centred on the origin before this, so the transform is identity
    rotation with a translation to the plate centre and half the height in Z —
    the same convention the shipped projects use.
    """
    tx, ty = bed_center
    transform = f"1 0 0 0 1 0 0 0 1 {tx:.6g} {ty:.6g} {height / 2:.6g}"
    return re.sub(r'(<item\b[^>]*\btransform=")[^"]*(")', rf"\g<1>{transform}\g<2>", main_model, count=1)


def build_from_template(template: Path, mesh_path: Path, out_3mf: Path,
                        bed_center: tuple[float, float] = (128.0, 128.0)) -> dict:
    """Copy the template, replacing its single object with our mesh."""
    import trimesh

    template, mesh_path, out_3mf = Path(template), Path(mesh_path), Path(out_3mf)
    info = validate_template(template)
    mesh = trimesh.load(str(mesh_path), force="mesh")
    # Centre in X/Y and sit on Z=0 in local coordinates; the build item's
    # translation then places it on the plate.
    mesh.apply_translation(-mesh.bounding_box.centroid)
    extents = mesh.bounding_box.extents

    out_3mf.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(template) as src, zipfile.ZipFile(out_3mf, "w", zipfile.ZIP_DEFLATED) as dst:
        object_id = _object_id_of(src.read(info["object_entry"]))
        for item in src.infolist():
            name = item.filename
            if name == info["object_entry"]:
                dst.writestr(name, mesh_object_xml(mesh, object_id))
            elif name == MAIN_MODEL_ENTRY:
                main = src.read(name).decode("utf-8")
                dst.writestr(name, place_on_plate(main, bed_center, float(extents[2])))
            elif name.startswith("Metadata/") and name.endswith(".png"):
                continue  # stale thumbnails of the template's object
            else:
                dst.writestr(item, src.read(name))
    return {
        "project": str(out_3mf),
        "printer": info["printer"],
        "process": info["process"],
        "filaments": info["filaments"],
        "size_mm": [round(float(v), 2) for v in extents],
    }
