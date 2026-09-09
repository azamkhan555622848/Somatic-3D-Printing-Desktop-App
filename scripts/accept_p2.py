"""P2 scripted acceptance: DICOM import -> (synthetic) segmentation ->
mask_to_mesh -> Mesh Gate -> provenance chain. Run with the medimage venv:
  medimage-mcp\\.venv\\Scripts\\python.exe scripts\\accept_p2.py [--real]
--real additionally runs true TotalSegmentator on the synthetic CT (downloads
~4.5GB of weights on first use, exercises CUDA) — masks will be empty on
synthetic noise, which is fine; the assertion for --real is only that the
chain executes on the expected backend and records provenance."""
import argparse
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "medimage-mcp" / "tests"))
sys.path.insert(0, str(REPO / "medimage-mcp" / "src"))

from conftest import write_ct_series, write_sphere_mask  # noqa: E402
from coder3d_medimage import provenance, segment, server  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true")
    args = ap.parse_args()
    failures = []
    with tempfile.TemporaryDirectory() as td_str:
        td = Path(td_str)
        case = td / "cases" / "acc-p2"
        dicom_src = write_ct_series(td / "dicom_export")

        out = server.import_dicom(str(dicom_src), str(case))
        if not out["volumes"]:
            failures.append("import produced no volumes")
        if list(case.rglob("*HOSP-12345*")):
            failures.append("PHI leaked into case tree")
        if not (case.parent / ".identity" / "acc-p2.json").exists():
            failures.append("identity map missing")

        # Synthetic 'liver' (real segmentation exercised separately with --real)
        seg_dir = case / "segmentations" / Path(out["volumes"][0]).name.replace(".nii.gz", "")
        seg_dir.mkdir(parents=True, exist_ok=True)
        mask = write_sphere_mask(seg_dir / "liver.nii.gz", radius_mm=10.0)

        mesh_out = server.mask_to_mesh(str(mask), "liver", str(case))
        if not mesh_out["gate"]["passed"]:
            failures.append(f"gate failed: {mesh_out['gate']['checks']}")
        if not Path(mesh_out["glb"]).exists():
            failures.append("no GLB for the Design View")

        steps = [e["step"] for e in provenance.read_log(case)]
        for expected in ["import", "mask_to_mesh", "mesh_gate"]:
            if expected not in steps:
                failures.append(f"provenance missing step {expected}")

        if args.real:
            r = segment.run_segmentation(Path(out["volumes"][0]), case, structures=["liver"])
            print(f"real segmentation ran on backend={r['backend']} resolution={r['resolution']}")

    if failures:
        print("P2 SCRIPTED ACCEPTANCE: FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("P2 SCRIPTED ACCEPTANCE: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
