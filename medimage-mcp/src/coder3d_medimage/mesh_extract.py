"""Mask → printable surface: flying edges + volume-preserving windowed sinc.

Never plain Laplacian (spec §4.1): Laplacian smoothing shrinks anatomy;
vtkWindowedSincPolyDataFilter with NormalizeCoordinatesOn is the standard
volume-preserving smoother. Anisotropic voxels are resampled isotropic first
so smoothing cannot drag the surface further along one axis than another.
"""
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import trimesh
import vtk
from vtk.util import numpy_support

from coder3d_medimage.provenance import append_entry


def _resample_isotropic(img: sitk.Image) -> sitk.Image:
    spacing = img.GetSpacing()
    iso = float(min(spacing))
    if max(spacing) / iso < 1.05:
        return img
    new_size = [int(round(sz * sp / iso)) for sz, sp in zip(img.GetSize(), spacing)]
    return sitk.Resample(img, new_size, sitk.Transform(), sitk.sitkNearestNeighbor,
                         img.GetOrigin(), (iso, iso, iso), img.GetDirection(), 0, sitk.sitkUInt8)


def mask_to_mesh(mask_path: Path, case_dir: Path, name: str,
                 smooth_iterations: int = 20, passband: float = 0.1) -> dict:
    case_dir = Path(case_dir)
    img = sitk.ReadImage(str(mask_path))
    img = _resample_isotropic(img)
    arr = sitk.GetArrayFromImage(img)  # z, y, x
    sx, sy, sz = img.GetSpacing()
    ox, oy, oz = img.GetOrigin()

    data = vtk.vtkImageData()
    nz, ny, nx = arr.shape
    data.SetDimensions(nx, ny, nz)
    data.SetSpacing(sx, sy, sz)
    data.SetOrigin(ox, oy, oz)
    flat = numpy_support.numpy_to_vtk((arr > 0).astype(np.uint8).ravel(),
                                      deep=True, array_type=vtk.VTK_UNSIGNED_CHAR)
    data.GetPointData().SetScalars(flat)

    fe = vtk.vtkFlyingEdges3D()
    fe.SetInputData(data)
    fe.SetValue(0, 0.5)
    fe.Update()
    surface = fe.GetOutput()

    if smooth_iterations > 0:
        ws = vtk.vtkWindowedSincPolyDataFilter()
        ws.SetInputData(surface)
        ws.SetNumberOfIterations(smooth_iterations)
        ws.SetPassBand(passband)
        ws.BoundarySmoothingOff()
        ws.NonManifoldSmoothingOn()
        ws.NormalizeCoordinatesOn()
        ws.Update()
        surface = ws.GetOutput()

    verts = numpy_support.vtk_to_numpy(surface.GetPoints().GetData()).astype(np.float64)
    faces = numpy_support.vtk_to_numpy(surface.GetPolys().GetData()).reshape(-1, 4)[:, 1:]
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    trimesh.repair.fix_normals(mesh)

    out_dir = case_dir / "meshes"
    out_dir.mkdir(parents=True, exist_ok=True)
    stl, glb = out_dir / f"{name}.stl", out_dir / f"{name}.glb"
    mesh.export(stl)
    mesh.export(glb)
    result = {"stl": str(stl), "glb": str(glb), "faces": int(len(mesh.faces)),
              "volume_mm3": float(abs(mesh.volume)), "watertight": bool(mesh.is_watertight)}
    append_entry(case_dir, step="mask_to_mesh", tool="medimage.mask_to_mesh",
                 params={"name": name, "smooth_iterations": smooth_iterations, "passband": passband},
                 inputs=[Path(mask_path)], outputs=[stl, glb])
    return result
