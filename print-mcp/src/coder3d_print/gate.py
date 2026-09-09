"""Print Gate (spec §5.3) — checks run in tool code, never agent judgment.

The Mesh Gate answers "is this geometry faithful to the scan". This one answers
the next question: "is this job safe to hand a printer". A sliced file always
looks plausible — it opens, it previews, it reports a time and a weight — so
every failure mode here is one that a human eye on the preview does not catch:
a file sliced for a different machine, a support strategy nobody chose, a part
that will not fit the plate once the aux nozzle takes its share of X, or a
load-bearing part in a material that creeps.

The verdict lands in `prints/qa/` (machine-owned) with a provenance entry.
"""
import json
from pathlib import Path

from .provenance import append_entry
from .report import read_stats

# X2D build volume; dual-nozzle mode loses X to the second toolhead.
PLATE_MM = (256.0, 256.0, 260.0)
PLATE_AUX_MM = (235.5, 256.0, 256.0)

SUPPORT_STRATEGIES = ("none", "same-material", "aux-nozzle")

# Materials that hold their shape under sustained load and warm air. PLA and
# PETG are display materials here on purpose: PLA creeps at body-adjacent
# temperatures and a prosthesis is worn, not looked at.
LOAD_BEARING_MATERIALS = ("ABS", "ASA", "PA", "PAHT", "PPA", "PC", "PPS")
LOAD_BEARING_USES = ("prosthetic", "orthotic", "load-bearing", "surgical-guide", "fixture")
DISPLAY_USES = ("display", "anatomy", "teaching", "planning")

PLATE_GCODE_PREFIX = "Metadata/plate_"


def _check(passed: bool, detail: str, **extra) -> dict:
    return {"passed": bool(passed), "detail": detail, **extra}


def _material_family(material: str) -> str:
    """"PA-CF", "ABS-GF" and "PAHT-CF" are the same families as their bases."""
    return str(material or "").strip().upper().split("-")[0]


def print_gate(
    gcode_3mf: Path,
    mesh_path: Path,
    case_dir: Path,
    *,
    support_strategy: str | None,
    material: str,
    intended_use: str | None = None,
    use_aux_nozzle: bool = False,
    expect_printer: str = "X2D",
) -> dict:
    import zipfile

    import trimesh

    gcode_3mf, case_dir = Path(gcode_3mf), Path(case_dir)

    # 1. slicer_ok — a project that was never sliced carries no toolpath.
    try:
        with zipfile.ZipFile(gcode_3mf) as archive:
            names = archive.namelist()
        has_gcode = any(n.startswith(PLATE_GCODE_PREFIX) and n.endswith(".gcode") for n in names)
    except (OSError, zipfile.BadZipFile) as exc:
        names, has_gcode = [], False
        slicer_detail = f"{gcode_3mf.name} could not be opened as a 3MF archive: {exc}"
    else:
        slicer_detail = (
            f"{gcode_3mf.name} carries a toolpath" if has_gcode
            else f"{gcode_3mf.name} has no Metadata/plate_N.gcode - it was not sliced"
        )

    stats: dict = {}
    if has_gcode:
        try:
            stats = read_stats(gcode_3mf)
        except (ValueError, KeyError) as exc:
            has_gcode = False
            slicer_detail = f"{gcode_3mf.name} has no readable slice_info: {exc}"

    checks: dict[str, dict] = {"slicer_ok": _check(has_gcode, slicer_detail)}

    # 2. machine — the file must be for the printer it is going to.
    machine = str(stats.get("printer_settings_id") or stats.get("printer_model_id") or "")
    machine_ok = expect_printer.lower() in machine.lower()
    checks["machine"] = _check(
        machine_ok,
        f"sliced for {machine or 'an unnamed printer'}"
        + ("" if machine_ok else f", not the {expect_printer} - reslice with the {expect_printer} profile"),
        printer=machine,
        expected=expect_printer,
    )

    # 3. support_strategy — an explicit choice, cross-checked against the slice.
    strategy = str(support_strategy or "").strip().lower()
    if strategy not in SUPPORT_STRATEGIES:
        checks["support_strategy"] = _check(
            False,
            f"support strategy must be one of {', '.join(SUPPORT_STRATEGIES)}; "
            f"got {support_strategy!r}. Decide it - the support choice is what the "
            "downward-facing anatomy will look like.",
            strategy=support_strategy,
        )
    else:
        support_used = bool(stats.get("support_used"))
        contradiction = strategy == "none" and support_used
        missing = strategy != "none" and has_gcode and not support_used
        if contradiction:
            detail = "strategy is 'none' but the slicer generated support - the file and the plan disagree"
        elif missing:
            detail = f"strategy is {strategy!r} but the slicer generated no support"
        else:
            detail = f"support strategy {strategy!r} matches the sliced file"
        checks["support_strategy"] = _check(
            not contradiction and not missing, detail, strategy=strategy, support_used=support_used
        )

    # 4. plate_fit — measured on the mesh, in the mode the job will run in.
    limits = PLATE_AUX_MM if use_aux_nozzle else PLATE_MM
    try:
        mesh = trimesh.load(str(mesh_path), force="mesh")
        extents = [float(v) for v in mesh.bounding_box.extents]
    except Exception as exc:
        extents = []
        checks["plate_fit"] = _check(False, f"{Path(mesh_path).name} could not be measured: {exc}")
    if extents:
        # Measured as authored, with no allowance for turning the part: the
        # slicer runs with --arrange and --orient off (a medical part is
        # oriented deliberately), so the mesh's own footprint is what lands on
        # the plate. Passing a job that only fits after a rotation nobody will
        # perform would just move the failure downstream.
        width, depth, height = extents
        fits = width <= limits[0] and depth <= limits[1] and height <= limits[2]
        checks["plate_fit"] = _check(
            fits,
            f"{width:.1f} x {depth:.1f} x {height:.1f} mm "
            + ("fits" if fits else "does not fit")
            + f" the {limits[0]:.1f} x {limits[1]:.1f} x {limits[2]:.1f} mm plate"
            + (" (dual-nozzle mode)" if use_aux_nozzle else ""),
            extents_mm=[round(v, 2) for v in extents],
            limits_mm=list(limits),
        )

    # 5. material_fit — the intended use is stated, never inferred.
    use = str(intended_use or "").strip().lower()
    family = _material_family(material)
    if use in LOAD_BEARING_USES:
        ok = family in LOAD_BEARING_MATERIALS
        detail = (
            f"{material} is rated for a {use} part" if ok
            else f"{material} is a display material; a {use} part needs one of "
                 f"{', '.join(LOAD_BEARING_MATERIALS)}"
        )
    elif use in DISPLAY_USES:
        ok, detail = True, f"{material} is fine for a {use} model"
    else:
        ok = False
        detail = (
            f"intended_use must be stated - one of {', '.join(LOAD_BEARING_USES + DISPLAY_USES)}. "
            "Whether this material is adequate depends entirely on what the part is for, "
            "and that is not something to guess."
        )
    checks["material_fit"] = _check(ok, detail, material=material, intended_use=intended_use)

    # 6. stats_attached — a job with no time or weight was not really sliced.
    time_s = int(stats.get("print_time_s") or 0)
    weight = float(stats.get("weight_g") or 0.0)
    checks["stats_attached"] = _check(
        time_s > 0 and weight > 0,
        f"{stats.get('print_time_human', '?')} / {weight:.2f} g"
        if time_s > 0 and weight > 0
        else "the sliced file reports no print time or weight",
        print_time_s=time_s,
        weight_g=weight,
    )

    passed = all(c["passed"] for c in checks.values())

    qa_dir = case_dir / "prints" / "qa"
    qa_dir.mkdir(parents=True, exist_ok=True)
    report_path = qa_dir / f"{gcode_3mf.name.split('.')[0]}.gate.json"
    report = {
        "passed": passed,
        "job": str(gcode_3mf),
        "mesh": str(mesh_path),
        "stats": stats,
        "checks": checks,
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    inputs = [p for p in (gcode_3mf, Path(mesh_path)) if p.is_file()]
    append_entry(
        case_dir,
        step="print_gate",
        tool="print.print_gate",
        params={
            "support_strategy": support_strategy,
            "material": material,
            "intended_use": intended_use,
            "use_aux_nozzle": use_aux_nozzle,
            "expect_printer": expect_printer,
        },
        inputs=inputs,
        outputs=[report_path],
    )
    return {"passed": passed, "checks": checks, "stats": stats, "report": str(report_path)}
