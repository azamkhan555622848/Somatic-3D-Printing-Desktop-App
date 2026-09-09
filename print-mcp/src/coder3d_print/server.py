"""3D-Coder print MCP server (stdio).

Import-light on purpose: an 18 s import in a sibling server blocked opencode's
instance bootstrap and emptied the MCP list for every project (P2 lesson), so
trimesh and friends are imported inside the tool bodies, never at module load.
"""
from pathlib import Path

from fastmcp import FastMCP

mcp = FastMCP("coder3d-print")


def _write_json(path: Path, payload: dict) -> None:
    """Write through a temp name: the panel watches this directory and would
    otherwise read a half-written sidecar."""
    import json

    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)


@mcp.tool
def printer_profiles() -> dict:
    """What Bambu Studio and the X2D profiles look like on this machine.

    Call this first if slicing fails: it either reports the discovered profiles
    or the exact install step that is missing.
    """
    from coder3d_print import slicer

    binary = slicer.find_bambu_studio()
    if binary is None:
        return {"ok": False, "message": slicer.INSTALL_HINT}
    try:
        found = slicer.find_x2d_profiles(slicer.install_root(binary))
    except slicer.ProfilesMissing as exc:
        return {"ok": False, "slicer": str(binary), "message": str(exc)}
    return {
        "ok": True,
        "slicer": str(binary),
        "machine": str(found["machine"]),
        "process": str(found["process"]),
        "filaments": [f.name for f in found["filaments"]][:20],
    }


@mcp.tool
def list_print_templates(case_dir: str) -> dict:
    """Bambu project templates available to slice into.

    A template is a complete project exported from Bambu Studio with the
    printer, filament and process already chosen; the mesh is swapped into it.
    Composing the settings ourselves crashes the slicer, so this is the only
    supported path.
    """
    from coder3d_print import project

    roots = [Path(case_dir) / "print-templates", Path(case_dir).parent.parent / "print-templates"]
    templates, problems = [], []
    for root in roots:
        for path in sorted(root.glob("*.3mf")) if root.is_dir() else []:
            try:
                info = project.validate_template(path)
            except project.TemplateInvalid as exc:
                problems.append(str(exc))
                continue
            templates.append({"path": str(path), **info})
    return {
        "templates": templates,
        "problems": problems,
        "hint": (
            "No template found. In Bambu Studio select the Bambu Lab X2D printer, the filament "
            "and the process you want, load any single object, then File > Export > Export project "
            "into <workspace>/print-templates/. One template per material/process."
        ) if not templates else "",
    }


@mcp.tool
def slice_model(
    mesh: str,
    case_dir: str,
    template: str,
    support_strategy: str,
    material: str,
    intended_use: str,
    use_aux_nozzle: bool = False,
    ams_mapping: dict | None = None,
    trays: list | None = None,
) -> dict:
    """Slice a gated mesh into a printable job and run the Print Gate on it.

    `support_strategy` is one of none | same-material | aux-nozzle and
    `intended_use` one of display | anatomy | teaching | planning | prosthetic |
    orthotic | load-bearing | surgical-guide | fixture. Both are required and
    neither is guessed: they decide whether the result is safe to print.

    A failed gate is reported as failed - the job file is left in place so the
    verdict can be read, but `ok` is false and it must not go to the printer.
    """
    from coder3d_print import ams as ams_mod
    from coder3d_print import gate as gate_mod
    from coder3d_print import project, report, slicer

    case = Path(case_dir)
    prints = case / "prints"
    prints.mkdir(parents=True, exist_ok=True)
    staged = prints / f"{Path(mesh).stem}.project.3mf"

    try:
        built = project.build_from_template(Path(template), Path(mesh), staged)
    except (project.TemplateInvalid, OSError) as exc:
        return {"ok": False, "stage": "template", "message": str(exc)}

    binary = slicer.find_bambu_studio()
    if binary is None:
        return {"ok": False, "stage": "slicer", "message": slicer.INSTALL_HINT}

    run = slicer.slice_project(staged, prints)
    if not run.get("ok"):
        return {"ok": False, "stage": "slice", "project": built, **run}

    job = Path(run["output"])
    verdict = gate_mod.print_gate(
        job, Path(mesh), case,
        support_strategy=support_strategy,
        material=material,
        intended_use=intended_use,
        use_aux_nozzle=use_aux_nozzle,
    )

    plan = None
    if ams_mapping:
        try:
            plan = ams_mod.plan_slots(ams_mapping, trays or [], use_aux_nozzle=use_aux_nozzle)
        except ValueError as exc:
            plan = {"slots": [], "warnings": [str(exc)]}

    # Sidecars for the Print View. The renderer reads these instead of the
    # archive: a plate_N.gcode runs to hundreds of MB, and parsing it in the
    # browser process would stall the window every time a job is opened.
    stem = job.name.split(".")[0]
    _write_json(prints / f"{stem}.stats.json", {
        **verdict["stats"],
        "gate": {"passed": verdict["passed"], "checks": verdict["checks"]},
        "support_strategy": support_strategy,
        "material": material,
        "intended_use": intended_use,
        "use_aux_nozzle": use_aux_nozzle,
        "ams": plan,
    })
    _write_json(prints / f"{stem}.layers.json", report.layer_preview(job))

    return {
        # The gate is the verdict, not a note attached to a success.
        "ok": bool(verdict["passed"]),
        "stage": "gate" if not verdict["passed"] else "done",
        "job": str(job),
        "project": built,
        "stats": verdict["stats"],
        "gate": verdict,
        "ams": plan,
        "warnings": run.get("warnings", []),
    }


@mcp.tool
def print_report(job: str, max_layers: int = 400) -> dict:
    """Stats and a decimated per-layer preview of a sliced job."""
    from coder3d_print import report

    path = Path(job)
    return {
        "stats": report.read_stats(path),
        "preview": report.layer_preview(path, max_layers=max_layers),
    }


@mcp.tool
def list_usb_drives() -> dict:
    """Removable drives the sliced job can be written to."""
    from coder3d_print import usb

    drives = usb.removable_drives()
    return {
        "drives": drives,
        "hint": "" if drives else "No removable drive detected. Insert the USB stick and call this again.",
    }


@mcp.tool
def export_to_usb(job: str, drive: str, case_dir: str, subdir: str = "") -> dict:
    """Copy a sliced job to a USB drive and verify the bytes that landed.

    Refuses a job whose Print Gate verdict is missing or failed: the stick is
    the last place a wrong file can still be stopped.
    """
    import json

    from coder3d_print import usb

    path = Path(job)
    verdict_path = Path(case_dir) / "prints" / "qa" / f"{path.name.split('.')[0]}.gate.json"
    if not verdict_path.is_file():
        return {"ok": False, "message": f"No Print Gate verdict for {path.name}. Slice it through slice_model first."}
    try:
        verdict = json.loads(verdict_path.read_text(encoding="utf-8"))
    except ValueError as exc:
        return {"ok": False, "message": f"The gate verdict for {path.name} is unreadable: {exc}"}
    if not verdict.get("passed"):
        failed = [name for name, check in (verdict.get("checks") or {}).items() if not check.get("passed")]
        return {
            "ok": False,
            "message": f"{path.name} failed the Print Gate ({', '.join(failed)}). "
                       f"Read {verdict_path} and fix the job before printing it.",
        }
    return usb.export_job(path, drive, Path(case_dir), subdir=subdir)


if __name__ == "__main__":
    mcp.run()
