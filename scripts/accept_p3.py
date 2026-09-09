"""P3 scripted acceptance: slice report -> Print Gate -> AMS map -> USB export.

Run with the print venv:
  print-mcp\\.venv\\Scripts\\python.exe scripts\\accept_p3.py [--real TEMPLATE.3mf]

The default run is parser-level and needs no slicer: a synthetic `.gcode.3mf`
drives the stats and layer parsers, the gate is exercised on a known-good and a
known-bad job, and the USB export is verified into a temp directory standing in
for a stick.

`--real <template>` additionally slices a real mesh through Bambu Studio using
a project template exported from the GUI, then runs the same chain over the
genuine archive. The template must be an X2D project — the gate refuses
anything else, which is the point of the check.
"""
import argparse
import json
import sys
import tempfile
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "print-mcp" / "tests"))
sys.path.insert(0, str(REPO / "print-mcp" / "src"))

from fixtures.make_fixture_3mf import SLICE_INFO, write_fixture  # noqa: E402

from coder3d_print import ams, gate, project, provenance, report, slicer, usb  # noqa: E402

X2D_SETTINGS = json.dumps({
    "printer_model": "Bambu Lab X2D",
    "printer_settings_id": "Bambu Lab X2D 0.4 nozzle",
    "print_settings_id": "0.20mm Standard @BBL X2D",
})


def check(failures: list, label: str, condition: bool, detail: str = "") -> None:
    print(f"{'  ok  ' if condition else ' FAIL '} {label}{f' - {detail}' if detail else ''}")
    if not condition:
        failures.append(label)


def synthetic_job(tmp: Path, name: str, settings: str = X2D_SETTINGS, slice_info: str = SLICE_INFO) -> Path:
    path = write_fixture(tmp / name, slice_info=slice_info)
    repack = path.with_suffix(".repack")
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(repack, "w") as dst:
        for entry in src.namelist():
            dst.writestr(entry, settings if entry.endswith("project_settings.config") else src.read(entry))
    repack.replace(path)
    return path


def parser_lane(tmp: Path, failures: list) -> None:
    import trimesh

    print("\n-- parsers --")
    info = SLICE_INFO.replace('key="support_used" value="true"', 'key="support_used" value="false"')
    job = synthetic_job(tmp, "good.gcode.3mf", slice_info=info)

    stats = report.read_stats(job)
    check(failures, "stats: print time parsed", stats["print_time_s"] == 4530, stats["print_time_human"])
    check(failures, "stats: weight parsed", stats["weight_g"] == 61.24)
    check(failures, "stats: slots are 0-based", [s["slot"] for s in stats["slots"]] == [0, 1])
    check(failures, "stats: machine resolved", "X2D" in stats["printer_settings_id"], stats["printer_settings_id"])

    preview = report.layer_preview(job)
    check(failures, "layers: grouped by layer", len(preview["layers"]) == 2)
    check(failures, "layers: height derived", preview["layer_height_mm"] == 0.2)

    print("\n-- gate --")
    mesh_path = tmp / "part.stl"
    trimesh.creation.box(extents=(20.0, 30.0, 40.0)).export(str(mesh_path))
    case = tmp / "case"

    good = gate.print_gate(job, mesh_path, case, support_strategy="none", material="PLA", intended_use="display")
    check(failures, "gate: a clean job passes", good["passed"] is True,
          ", ".join(n for n, c in good["checks"].items() if not c["passed"]))

    a1 = synthetic_job(tmp, "wrong-machine.gcode.3mf",
                       settings=json.dumps({"printer_settings_id": "Bambu Lab A1 0.4 nozzle"}),
                       slice_info=info)
    bad = gate.print_gate(a1, mesh_path, case, support_strategy="none", material="PLA", intended_use="display")
    check(failures, "gate: another printer's file is refused",
          bad["passed"] is False and bad["checks"]["machine"]["passed"] is False)

    pla = gate.print_gate(job, mesh_path, case, support_strategy="none", material="PLA", intended_use="prosthetic")
    check(failures, "gate: a prosthetic in PLA is refused", pla["checks"]["material_fit"]["passed"] is False)

    guessy = gate.print_gate(job, mesh_path, case, support_strategy="auto", material="ABS", intended_use="prosthetic")
    check(failures, "gate: an unstated support strategy is refused",
          guessy["checks"]["support_strategy"]["passed"] is False)

    oversized = tmp / "oversized.stl"
    trimesh.creation.box(extents=(300.0, 20.0, 20.0)).export(str(oversized))
    big = gate.print_gate(job, oversized, case, support_strategy="none", material="PLA", intended_use="display")
    check(failures, "gate: an oversized part is refused", big["checks"]["plate_fit"]["passed"] is False)

    check(failures, "gate: the verdict is machine-written to prints/qa",
          Path(good["report"]).parent == case / "prints" / "qa")

    print("\n-- ams --")
    trays = [{"type": "PLA", "colour": c} for c in ("red", "white", "green", "black")]
    plan = ams.plan_slots({"tumour": "red", "parenchyma": "white"}, trays)
    check(failures, "ams: structures take distinct trays", [s["slot"] for s in plan["slots"]] == [0, 1])
    crowded = ams.plan_slots({f"s{i}": c for i, c in enumerate(["red", "white", "green", "black", "blue"])}, trays)
    check(failures, "ams: an unplaceable structure warns instead of vanishing",
          crowded["unassigned"] == ["s4"] and any("s4" in w for w in crowded["warnings"]))

    print("\n-- usb --")
    stick = tmp / "stick"
    stick.mkdir()
    exported = usb.export_job(job, str(stick), case)
    check(failures, "usb: the copy is verified byte for byte", exported["ok"] and exported["verified"])
    check(failures, "usb: the operator is told which drive to eject", "eject" in exported["message"].lower())
    absent = usb.export_job(job, str(tmp / "nowhere"), case)
    check(failures, "usb: a missing drive is refused, not created",
          absent["ok"] is False and not (tmp / "nowhere").exists())

    print("\n-- provenance --")
    log = provenance.read_log(case)
    steps = [e["step"] for e in log]
    check(failures, "provenance: the gate and the export are both recorded",
          "print_gate" in steps and "export_to_usb" in steps, ", ".join(dict.fromkeys(steps)))
    check(failures, "provenance: every entry carries output hashes",
          all(o["sha256"] for e in log for o in e["outputs"]))


def real_lane(tmp: Path, failures: list, template: Path, mesh: Path) -> None:
    print("\n-- real slice --")
    binary = slicer.find_bambu_studio()
    if binary is None:
        check(failures, "real: Bambu Studio present", False, slicer.INSTALL_HINT)
        return
    info = project.validate_template(template)
    check(failures, "real: the template is an X2D project", "X2D" in info["printer"], info["printer"])

    staged = tmp / "staged.3mf"
    built = project.build_from_template(template, mesh, staged)
    print(f"        staged {built['size_mm']} mm into {info['printer']} / {info['process']}")

    run = slicer.slice_project(staged, tmp / "out")
    check(failures, "real: the slice returns cleanly", bool(run.get("ok")),
          run.get("error") or f"rc={run.get('returncode')}")
    if not run.get("ok"):
        return

    job = Path(run["output"])
    stats = report.read_stats(job)
    check(failures, "real: stats came back", stats["print_time_s"] > 0 and stats["weight_g"] > 0,
          f"{stats['print_time_human']} / {stats['weight_g']} g")
    preview = report.layer_preview(job)
    check(failures, "real: the toolpath produced layers", len(preview["layers"]) > 10,
          f"{len(preview['layers'])} layers at {preview['layer_height_mm']} mm")
    drawn = sum(len(p) for layer in preview["layers"] for p in layer["polylines"])
    check(failures, "real: the layers carry geometry", drawn > 1000, f"{drawn} points")

    verdict = gate.print_gate(job, mesh, tmp / "real-case", support_strategy="none",
                              material="PLA", intended_use="display")
    check(failures, "real: the gate reaches a verdict on a genuine job",
          verdict["checks"]["slicer_ok"]["passed"] and verdict["checks"]["stats_attached"]["passed"])
    check(failures, "real: the machine check agrees with the template",
          verdict["checks"]["machine"]["passed"], verdict["checks"]["machine"]["detail"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", metavar="TEMPLATE_3MF",
                    help="also slice for real using this Bambu project template")
    ap.add_argument("--mesh", help="mesh to slice with --real (default: the demo tube rack)")
    args = ap.parse_args()

    failures: list = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        parser_lane(tmp, failures)
        if args.real:
            mesh = Path(args.mesh) if args.mesh else REPO / "workspace" / "cases" / "demo" / "meshes" / "tube_rack.stl"
            if not mesh.is_file():
                check(failures, "real: mesh present", False, f"{mesh} not found - pass --mesh")
            else:
                real_lane(tmp, failures, Path(args.real), mesh)

    print()
    if failures:
        print(f"P3 SCRIPTED ACCEPTANCE: FAIL ({len(failures)}): {', '.join(failures)}")
        return 1
    print("P3 SCRIPTED ACCEPTANCE: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
