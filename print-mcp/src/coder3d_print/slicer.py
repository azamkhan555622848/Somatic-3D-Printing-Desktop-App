"""Locate Bambu Studio, its X2D profiles, and flatten them for the CLI.

Two facts drive this module, both verified against the shipped install:

1. `--load-settings` takes JSON FILES, not preset names.
2. The shipped system profiles are not self-contained — `Bambu Lab X2D 0.4
   nozzle.json` inherits `fdm_bbl_3dp_002_common`, which inherits
   `fdm_machine_common`. Handing the CLI the leaf alone loses the machine
   definition, so every profile is resolved down its chain and written out flat
   before slicing.
"""
import json
import os
from pathlib import Path

def _candidates() -> list[Path]:
    """Where Bambu Studio installs itself, per platform.

    Linux has no single answer: a distro package lands in /usr/bin, the vendor
    ships an AppImage that people keep wherever they downloaded it, and flatpak
    puts it under /app. All three are checked, newest AppImage first. Path
    accepts forward slashes on Windows too, so the Windows entries stay
    readable.
    """
    import sys
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "")
        return [
            Path("C:/Program Files/Bambu Studio/bambu-studio.exe"),
            Path("C:/Program Files (x86)/Bambu Studio/bambu-studio.exe"),
            *([Path(local) / "Programs" / "Bambu Studio" / "bambu-studio.exe"] if local else []),
        ]
    if sys.platform == "darwin":
        return [
            Path("/Applications/BambuStudio.app/Contents/MacOS/BambuStudio"),
            Path.home() / "Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
        ]
    appimages: list[Path] = []
    for directory in (Path.home() / "Applications", Path.home() / "Downloads",
                      Path("/opt"), Path.home() / ".local/bin"):
        try:
            appimages += sorted(directory.glob("*ambu*tudio*.AppImage"), reverse=True)
        except OSError:
            pass
    return [
        Path("/usr/bin/bambu-studio"),
        Path("/usr/local/bin/bambu-studio"),
        Path("/opt/bambu-studio/bambu-studio"),
        Path("/app/bin/bambu-studio"),  # flatpak
        *appimages,
    ]


_CANDIDATES = _candidates()

INSTALL_HINT = (
    "Bambu Studio is required for slicing. Install the latest version from "
    "https://bambulab.com/en/download/studio (it ships the X2D profiles), then "
    "restart 3D-Coder. If it lives somewhere unusual, set CODER3D_BAMBU_STUDIO "
    "to the full path of bambu-studio.exe."
)

# Default machine/process choice for the lab's X2D (0.4 mm nozzle, 0.2 mm layers).
DEFAULT_NOZZLE = "0.4 nozzle"
DEFAULT_PROCESS = "0.20mm Standard"
# Keys that describe where a preset came from rather than how to print.
_METADATA_KEYS = {"inherits", "from", "instantiation", "setting_id"}


class SlicerMissing(RuntimeError):
    def __init__(self):
        super().__init__(INSTALL_HINT)


class ProfilesMissing(RuntimeError):
    pass


def find_bambu_studio() -> Path | None:
    override = os.environ.get("CODER3D_BAMBU_STUDIO")
    if override:
        path = Path(override)
        return path if path.is_file() else None
    for candidate in _CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


# Where the shipped profiles live, relative to the binary. Windows keeps them
# beside the exe; a Linux package splits them into /usr/share.
_RESOURCE_HINT = Path("resources") / "profiles" / "BBL"


def install_root(binary: Path | None = None) -> Path | None:
    """The directory that contains `resources/profiles/BBL`.

    An AppImage carries its resources inside the image, so there is nothing on
    disk to point at: this returns None there rather than a directory that only
    looks right, and the caller reports that instead of slicing with a guess.
    """
    binary = binary or find_bambu_studio()
    if binary is None:
        return None
    for candidate in (binary.parent, binary.parent.parent,
                      Path("/usr/share/bambu-studio"), Path("/usr/share/BambuStudio"),
                      Path("/app/share/bambu-studio")):
        if (candidate / _RESOURCE_HINT).is_dir():
            return candidate
    return None


def _real_profiles(directory: Path) -> list[Path]:
    """Skip the `... template <something>_gcode.json` files: they hold gcode
    snippets, not printer definitions, and sort right next to the real ones."""
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.glob("*.json") if " template " not in p.name)


def _pick(files: list[Path], *needles: str) -> Path | None:
    for needle in needles:
        for f in files:
            if needle.lower() in f.name.lower():
                return f
    return None


def find_x2d_profiles(root: Path) -> dict:
    """root = the Bambu Studio install directory."""
    base = Path(root) / "resources" / "profiles" / "BBL"
    machines = _real_profiles(base / "machine")
    processes = _real_profiles(base / "process")
    filaments = _real_profiles(base / "filament")

    machine = _pick(machines, f"X2D {DEFAULT_NOZZLE}") or _pick(machines, "X2D")
    if machine is None:
        raise ProfilesMissing(
            "No X2D machine profile in this Bambu Studio install. Update Bambu Studio to a "
            "version that supports the X2D, or point CODER3D_X2D_MACHINE_PROFILE at an "
            "X2D profile exported from the GUI."
        )
    process = _pick(processes, f"{DEFAULT_PROCESS} @BBL X2D.json", DEFAULT_PROCESS, "X2D")
    if process is None:
        raise ProfilesMissing("No X2D process profile in this Bambu Studio install.")
    x2d_filaments = [f for f in filaments if "x2d" in f.name.lower() and DEFAULT_NOZZLE in f.name.lower()]
    return {"machine": machine, "process": process, "filaments": x2d_filaments or filaments}


def build_slice_args(model: Path, out_3mf: Path, profiles: dict, plate: int = 1,
                     timeout_s: int = 1800, arrange: bool = False, orient: bool = False,
                     extra: list[str] | None = None) -> list[str]:
    """Assemble the documented CLI invocation. Arrange/orient stay OFF by
    default: a medical part is oriented deliberately (support placement and
    layer direction matter), and letting the slicer re-pose it silently would
    invalidate the orientation the operator chose."""
    args = ["--slice", str(plate), "--load-settings", f"{profiles['machine']};{profiles['process']}"]
    filaments = profiles.get("filaments") or []
    if filaments:
        args += ["--load-filaments", ";".join(str(f) for f in filaments)]
    if arrange:
        args += ["--arrange", "1"]
    if orient:
        args += ["--orient"]
    args += [
        "--allow-newer-file",
        "--skip-useless-pick",
        "--mstpp", str(timeout_s),
        "--export-3mf", str(out_3mf),
    ]
    if extra:
        args += extra
    args.append(str(model))
    return args


def build_project_slice_args(project_3mf: Path, out_3mf: Path, plate: int = 1,
                             timeout_s: int = 1800) -> list[str]:
    """A project carries its own machine, filament and process, so it is sliced
    WITHOUT `--load-settings`. Adding external presets on top is exactly the
    combination that returns "input preset file is invalid" and, in some
    variants, crashes the slicer outright."""
    return [
        "--slice", str(plate),
        "--allow-newer-file",
        "--skip-useless-pick",
        "--mstpp", str(timeout_s),
        "--export-3mf", str(out_3mf),
        str(project_3mf),
    ]


def _run(binary: Path, args: list[str], out_3mf: Path, timeout_s: int) -> dict:
    """One headless slice in a throwaway working directory."""
    import shutil
    import subprocess
    import tempfile
    import time

    from . import report

    out_3mf.parent.mkdir(parents=True, exist_ok=True)
    out_3mf.unlink(missing_ok=True)
    sandbox = Path(tempfile.mkdtemp(prefix="coder3d-slice-"))
    try:
        proc = subprocess.run(
            [str(binary), *args], cwd=str(sandbox), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout_s + 120,
        )
        result_json = report.read_result_json(sandbox)
        # The export is not always visible the instant the process exits (a cold
        # slice was observed writing it late), so a successful run gets a short
        # grace period rather than being reported as a silent failure.
        if proc.returncode == 0 and (result_json or {}).get("return_code", 0) == 0:
            deadline = time.monotonic() + 30
            while not out_3mf.is_file() and time.monotonic() < deadline:
                time.sleep(0.25)
        ok = out_3mf.is_file()
        return report.merge_slice_result(
            {
                "ok": ok,
                "output": str(out_3mf) if ok else "",
                "returncode": proc.returncode,
                "stdout_tail": proc.stdout[-4000:],
                "stderr_tail": proc.stderr[-4000:],
            },
            result_json,
        )
    finally:
        # A slice drops hundreds of MB of temp files into the working directory.
        shutil.rmtree(sandbox, ignore_errors=True)


def slice_project(project_3mf: Path, out_dir: Path, plate: int = 1, timeout_s: int = 1800) -> dict:
    """Slice a Bambu project that already carries its own settings."""
    binary = find_bambu_studio()
    if binary is None:
        raise SlicerMissing()
    project_3mf, out_dir = Path(project_3mf), Path(out_dir)
    out_3mf = out_dir / f"{project_3mf.name.split('.')[0]}.gcode.3mf"
    args = build_project_slice_args(project_3mf, out_3mf, plate=plate, timeout_s=timeout_s)
    return _run(binary, args, out_3mf, timeout_s)


def slice_model(model: Path, out_dir: Path, profiles: dict, timeout_s: int = 1800,
                arrange: bool = False, orient: bool = False) -> dict:
    """Slice a bare model with externally supplied presets.

    NOTE: this is the documented path, and it does not work against the shipped
    profiles — see `project.py`. It is kept because a preset exported from the
    GUI may yet be accepted, but `slice_project` is what the lane uses.
    """
    binary = find_bambu_studio()
    if binary is None:
        raise SlicerMissing()
    model, out_dir = Path(model), Path(out_dir)
    out_3mf = out_dir / f"{model.stem}.gcode.3mf"
    args = build_slice_args(model, out_3mf, profiles, timeout_s=timeout_s,
                            arrange=arrange, orient=orient)
    return _run(binary, args, out_3mf, timeout_s)


def filament_for(material: str, filaments: list[Path], support: bool = False) -> Path | None:
    """Bambu names filaments `Bambu <material>[ variant] @BBL X2D <nozzle>`.

    Two traps live here. "Bambu Support For PLA @BBL ..." contains "PLA @BBL",
    so a naive match hands back support-interface material for the model body —
    support profiles are excluded unless they were asked for. And an exact
    material match must come first, or "ABS" selects ABS-GF and "PLA" selects
    PLA-CF.
    """
    pool = [f for f in filaments if ("support" in f.name.lower()) == support]
    return _pick(
        pool,
        f"{material} Basic @BBL",    # Bambu PLA Basic @BBL X2D 0.4 nozzle
        f"{material} @BBL",          # Bambu ABS @BBL X2D 0.4 nozzle
        material,                    # anything else carrying the material name
    )


def resolve_profile(path: Path, _seen: set[str] | None = None) -> dict:
    """Merge a profile with everything it inherits, child winning."""
    path = Path(path)
    _seen = _seen or set()
    if path.stem in _seen:  # malformed profile set; stop rather than loop
        return {}
    _seen.add(path.stem)
    data = json.loads(path.read_text(encoding="utf-8"))
    parent_name = data.get("inherits")
    merged: dict = {}
    if parent_name:
        parent_path = path.with_name(f"{parent_name}.json")
        if parent_path.is_file():
            merged.update(resolve_profile(parent_path, _seen))
    merged.update(data)
    for key in _METADATA_KEYS:
        merged.pop(key, None)
    return merged


def materialize_profiles(found: dict, out_dir: Path, materials: list[str] | None = None) -> dict:
    """Write flattened copies the CLI can consume. `materials` picks filament
    profiles by type (e.g. ["PLA", "ABS"]) in AMS slot order."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    def write(src: Path, name: str) -> Path:
        target = out_dir / name
        target.write_text(json.dumps(resolve_profile(src), indent=2), encoding="utf-8")
        return target

    result = {"machine": write(found["machine"], "machine.json"), "process": write(found["process"], "process.json")}

    chosen: list[Path] = []
    if materials:
        for index, material in enumerate(materials):
            match = filament_for(material, found.get("filaments", []))
            if match is None:
                raise ProfilesMissing(f"No X2D filament profile found for material {material!r}")
            chosen.append(write(match, f"filament_{index}.json"))
    elif found.get("filaments"):
        default = _pick(found["filaments"], "PLA Basic") or found["filaments"][0]
        chosen.append(write(default, "filament_0.json"))
    result["filaments"] = chosen
    return result
