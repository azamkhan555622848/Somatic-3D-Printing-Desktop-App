"""3D-Coder medical-imaging MCP server (stdio).

Heavy libraries (SimpleITK, vtk, trimesh, torch) are imported INSIDE the
tools, not here: a cold top-level import costs ~18s, and the app spawns this
server once per open project — enough to blow the instance-bootstrap deadline
and take every MCP server down with it (observed as /command 499s and an
empty MCP list). Startup must stay import-light.
"""
import json
from pathlib import Path

from fastmcp import FastMCP

mcp = FastMCP("coder3d-medimage")


@mcp.tool
def import_dicom(folder: str, case_dir: str) -> dict:
    """Import an exported DICOM folder into a case: de-identify (PHI stripped,
    original identity stored OUTSIDE the case in cases/.identity/), convert to
    NIfTI, and record series metadata. Returns case_id, volumes, metadata."""
    from coder3d_medimage import convert, deid, provenance

    case = Path(case_dir)
    case_id = case.name
    dicom_dir, nifti_dir = case / "dicom", case / "nifti"
    result = deid.deidentify_series(Path(folder), dicom_dir, case_id)
    identity_dir = case.parent / ".identity"
    identity_dir.mkdir(parents=True, exist_ok=True)
    (identity_dir / f"{case_id}.json").write_text(
        json.dumps(result["identity"], indent=2), encoding="utf-8")
    volumes = convert.dicom_to_nifti(dicom_dir, nifti_dir)
    meta = convert.series_metadata(dicom_dir)
    provenance.append_entry(case, step="import", tool="medimage.import_dicom",
                            params={"files": result["files"], **meta},
                            inputs=[], outputs=list(volumes))
    return {"case_id": case_id, "files": result["files"],
            "volumes": [str(v) for v in volumes], "metadata": meta}


@mcp.tool
def segment_volume(volume: str, case_dir: str, structures: str = "all",
                   modality: str = "CT") -> dict:
    """Segment a NIfTI volume with TotalSegmentator. structures: 'all' or a
    comma-separated subset (e.g. 'liver,spleen'). Backend chain: local CUDA ->
    lab GPU server (CODER3D_SEG_SERVER) -> CPU fast 3mm. The resolution used
    is always recorded. First run downloads ~4.5GB of model weights."""
    from coder3d_medimage import segment

    roi = None if structures == "all" else [s.strip() for s in structures.split(",")]
    return segment.run_segmentation(Path(volume), Path(case_dir),
                                    structures=roi, modality=modality)


@mcp.tool
def list_structures(case_dir: str, volume: str) -> dict:
    """List segmented structures and their volumes (ml) for a case volume."""
    stem = Path(volume).name.replace(".nii.gz", "").replace(".nii", "")
    labels = Path(case_dir) / "segmentations" / stem / "labels.json"
    if not labels.exists():
        return {"structures": {}, "note": "not segmented yet - run segment_volume"}
    return {"structures": json.loads(labels.read_text(encoding="utf-8"))}


@mcp.tool
def mask_to_mesh(mask: str, structure: str, case_dir: str) -> dict:
    """Extract a printable mesh from a segmentation mask (flying edges +
    volume-preserving smoothing) and run the Mesh Gate against the source
    mask. The gate verdict is machine-written to meshes/qa/ - a failed gate
    means the mesh must NOT proceed to CAD or slicing."""
    from coder3d_medimage import gate as gate_mod, mesh_extract

    result = mesh_extract.mask_to_mesh(Path(mask), Path(case_dir), name=structure)
    g = gate_mod.mesh_gate(Path(result["stl"]), Path(mask), Path(case_dir))
    return {**result, "gate": g}


if __name__ == "__main__":
    mcp.run()
