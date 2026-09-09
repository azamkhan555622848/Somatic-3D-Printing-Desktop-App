import numpy as np
import trimesh
from coder3d_medimage.mesh_extract import mask_to_mesh
from conftest import write_sphere_mask


def test_sphere_mesh_is_watertight_and_volume_preserving(sphere_mask, tmp_path):
    result = mask_to_mesh(sphere_mask, tmp_path, name="sphere")
    assert result["watertight"] is True
    expected = 4 / 3 * np.pi * 20.0 ** 3
    assert abs(result["volume_mm3"] - expected) / expected < 0.02  # volume-preserving smoothing
    mesh = trimesh.load(tmp_path / "meshes" / "sphere.stl")
    assert mesh.is_watertight
    assert (tmp_path / "meshes" / "sphere.glb").exists()


def test_anisotropic_mask_is_resampled(tmp_path):
    mask = write_sphere_mask(tmp_path / "aniso.nii.gz", spacing=(1.0, 1.0, 3.0))
    result = mask_to_mesh(mask, tmp_path, name="aniso")
    expected = 4 / 3 * np.pi * 20.0 ** 3
    assert abs(result["volume_mm3"] - expected) / expected < 0.05


def test_provenance_entry_written(sphere_mask, tmp_path):
    from coder3d_medimage.provenance import read_log
    mask_to_mesh(sphere_mask, tmp_path, name="sphere")
    assert any(e["step"] == "mask_to_mesh" for e in read_log(tmp_path))
