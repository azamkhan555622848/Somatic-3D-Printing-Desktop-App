"""Read a sliced `.gcode.3mf`: the printed stats, and a drawable layer preview.

Two entries in the archive matter.

`Metadata/slice_info.config` is the slicer's own summary — predicted seconds,
grams, support usage, and one `<filament>` per logical AMS slot. Bambu numbers
those from 1; everything on our side (the AMS mapping, the Print View) counts
from 0, and the translation happens here so it happens once.

`Metadata/plate_N.gcode` is the machine program. It is the only place the actual
toolpath exists, and on a real part it runs to hundreds of megabytes — so it is
walked line by line straight out of the zip and decimated on the way through.
Nothing here ever holds the whole entry in memory.
"""
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

SLICE_INFO_ENTRY = "Metadata/slice_info.config"
PROJECT_SETTINGS_ENTRY = "Metadata/project_settings.config"
RESULT_JSON = "result.json"

# Bambu writes floats without a leading zero (`E.00848`, `E-.34322`), so the
# usual `\d+\.\d+` pattern silently misses almost every extrusion in the file.
_NUM = r"(-?(?:\d+\.?\d*|\.\d+))"
_AXIS_RE = re.compile(rf"\b([XYIJ]){_NUM}")
_E_RE = re.compile(rf"\bE{_NUM}")
_Z_MOVE_RE = re.compile(rf"\bZ{_NUM}")
# `;Z:0.2` is Orca/Prusa; `; Z_HEIGHT: 0.2` is Bambu Studio.
_Z_COMMENT_RE = re.compile(rf"^;\s*(?:Z|Z_HEIGHT)\s*:\s*{_NUM}")
# `;LAYER_CHANGE` is Orca/Prusa; Bambu's layer_change_gcode emits the counter.
_LAYER_MARK_RE = re.compile(r"^;\s*(?:LAYER_CHANGE\b|layer num/total_layer_count\s*:)")
# `; FEATURE: Outer wall`. This is what makes a preview legible: without it the
# part renders as one opaque mass and an operator cannot see a wall, an infill
# or a bridge, which is exactly what they open a preview to check.
_FEATURE_RE = re.compile(r"^;\s*(?:FEATURE|TYPE)\s*:\s*(.+?)\s*$")
_NO_FEATURE = "Unknown"
# A preview only has to look right; 15 degrees a chord is well under a pixel.
_ARC_STEP_RAD = math.pi / 12
_ARC_MAX_SEGMENTS = 32


def _human_time(seconds: int) -> str:
    """Truncate rather than round: the slicer's own estimate is already a floor,
    and a job that reads back one minute longer than the slicer said looks wrong."""
    hours, remainder = divmod(int(seconds), 3600)
    minutes = remainder // 60
    return f"{hours}h {minutes}m" if hours else f"{minutes}m"


def _float(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def plate_gcode_entry(names: list[str], plate: int | None = None) -> str | None:
    """`Metadata/plate_1.gcode`. A multi-plate project has one per plate; we
    slice one plate at a time, so the first is the right default."""
    candidates = sorted(n for n in names if re.fullmatch(r"Metadata/plate_\d+\.gcode", n))
    if plate is not None:
        wanted = f"Metadata/plate_{plate}.gcode"
        return wanted if wanted in candidates else None
    return candidates[0] if candidates else None


def read_stats(gcode_3mf: Path, plate: int = 1) -> dict:
    """Stats for one plate, straight from the slicer's own summary."""
    with zipfile.ZipFile(Path(gcode_3mf)) as archive:
        names = archive.namelist()
        if SLICE_INFO_ENTRY not in names:
            raise ValueError(
                f"{Path(gcode_3mf).name} carries no {SLICE_INFO_ENTRY} - it is a project, "
                "not a sliced archive. Slice it first."
            )
        root = ET.fromstring(archive.read(SLICE_INFO_ENTRY).decode("utf-8"))
        settings = {}
        if PROJECT_SETTINGS_ENTRY in names:
            import json

            try:
                settings = json.loads(archive.read(PROJECT_SETTINGS_ENTRY).decode("utf-8"))
            except ValueError:
                settings = {}

    plates = root.findall("plate")
    chosen = next(
        (p for p in plates if p.find('metadata[@key="index"]') is not None
         and p.find('metadata[@key="index"]').get("value") == str(plate)),
        plates[0] if plates else None,
    )
    if chosen is None:
        raise ValueError(f"{SLICE_INFO_ENTRY} describes no plates")

    meta = {m.get("key"): m.get("value") for m in chosen.findall("metadata")}
    seconds = int(_float(meta.get("prediction")))
    slots = [
        {
            # slice_info ids are 1-based; slot 0 is the first AMS tray.
            "slot": int(_float(f.get("id"), 1)) - 1,
            "type": f.get("type", ""),
            "color": f.get("color", ""),
            "used_g": _float(f.get("used_g")),
            "used_m": _float(f.get("used_m")),
            "tray_info_idx": f.get("tray_info_idx", ""),
        }
        for f in chosen.findall("filament")
    ]
    return {
        "plate": int(_float(meta.get("index"), plate)),
        "print_time_s": seconds,
        "print_time_human": _human_time(seconds),
        "weight_g": _float(meta.get("weight")),
        "support_used": str(meta.get("support_used", "")).lower() == "true",
        "nozzle_diameters": meta.get("nozzle_diameters", ""),
        # slice_info leaves printer_model_id blank on a CLI slice (verified
        # against 2.8), so the project's own settings are the reliable answer to
        # "which machine is this file for" - the question the Print Gate asks.
        "printer_model_id": meta.get("printer_model_id") or settings.get("printer_model", ""),
        "printer_settings_id": settings.get("printer_settings_id", ""),
        "print_settings_id": settings.get("print_settings_id", ""),
        "slots": slots,
    }


def _iter_gcode_lines(archive: zipfile.ZipFile, entry: str):
    """Stream the entry as text. `z.open` keeps the decompressed bytes out of
    memory; a several-hundred-MB toolpath is normal for a segmented organ."""
    with archive.open(entry) as raw:
        for line in raw:
            yield line.decode("utf-8", "replace")


def _arc_points(start: list[float], end: list[float], i: float, j: float, clockwise: bool) -> list[list[float]]:
    """Tessellate a `G2`/`G3` arc. Bambu turns arc fitting on by default, so on
    a curved part nearly every extrusion is an arc — joining the endpoints with
    a straight chord would cut every corner off the preview."""
    cx, cy = start[0] + i, start[1] + j
    radius = math.hypot(start[0] - cx, start[1] - cy)
    if radius <= 0:
        return [end]
    a0 = math.atan2(start[1] - cy, start[0] - cx)
    a1 = math.atan2(end[1] - cy, end[0] - cx)
    sweep = a1 - a0
    if clockwise:
        while sweep > 0:
            sweep -= 2 * math.pi
    else:
        while sweep < 0:
            sweep += 2 * math.pi
    if abs(sweep) < 1e-9:  # start == end: a full circle, not a zero-length move
        sweep = -2 * math.pi if clockwise else 2 * math.pi
    steps = max(1, min(_ARC_MAX_SEGMENTS, math.ceil(abs(sweep) / _ARC_STEP_RAD)))
    points = [
        [cx + radius * math.cos(a0 + sweep * n / steps), cy + radius * math.sin(a0 + sweep * n / steps)]
        for n in range(1, steps)
    ]
    points.append(end)  # land exactly where the gcode says, not on the circle
    return points


def _decimate(points: list[list[float]], limit: int) -> list[list[float]]:
    """Thin a dense layer but keep both ends, so an extrusion run still starts
    and finishes where the printer does."""
    kept = points if len(points) <= limit else points[:: len(points) // limit + 1]
    if kept[-1] != points[-1]:
        kept = [*kept, points[-1]]
    # Micron precision is far past what a preview can show, and the extra
    # digits are pure payload on a several-hundred-layer job.
    return [[round(x, 3), round(y, 3)] for x, y in kept]


def layer_preview(
    gcode_3mf: Path,
    max_layers: int = 400,
    max_points_per_layer: int = 1200,
    plate: int | None = None,
) -> dict:
    """Extrusion moves grouped per layer, as polylines the renderer can draw.

    Travel moves are boundaries, not geometry: a polyline is closed when the
    head lifts off, and the travel's destination seeds the next one so the run
    starts where the printer starts. Retractions are not extrusions — under M82
    the E field is a running total, so only a rise over the previous value is
    material actually put on the plate.
    """
    path = Path(gcode_3mf)
    layers: list[dict] = []
    truncated = False

    with zipfile.ZipFile(path) as archive:
        entry = plate_gcode_entry(archive.namelist(), plate)
        if entry is None:
            return {"layer_height_mm": 0.0, "layers": [], "truncated": False, "features": []}

        absolute_e = False
        last_e = 0.0
        pos: list[float] | None = None
        seed: list[float] | None = None
        current: dict | None = None
        polyline: list[list[float]] = []
        pending_z: float | None = None
        # Feature names are interned to indices: the legend is written once per
        # file instead of repeating "Internal solid infill" on every path.
        features: list[str] = []
        feature_index = -1

        def intern(name: str) -> int:
            if name not in features:
                features.append(name)
            return features.index(name)

        def close_polyline():
            nonlocal polyline
            if current is not None and len(polyline) > 1:
                index = feature_index if feature_index >= 0 else intern(_NO_FEATURE)
                current["paths"].append({"f": index, "p": _decimate(polyline, max_points_per_layer)})
            polyline = []

        def close_layer():
            close_polyline()
            if current is not None:
                layers.append(current)

        for line in _iter_gcode_lines(archive, entry):
            line = line.strip()
            if not line:
                continue
            if line.startswith(";"):
                if _LAYER_MARK_RE.match(line):
                    close_layer()
                    # Bambu prints the height just BEFORE the layer marker and
                    # Orca just after, so the new layer opens with whichever was
                    # last seen and a following comment may still correct it.
                    current = {"z": pending_z or 0.0, "paths": []}
                    seed = None  # a fresh layer never continues the previous run
                    continue
                feature_match = _FEATURE_RE.match(line)
                if feature_match:
                    # A path never spans two features, or the renderer would
                    # paint half an infill run in the wall's colour.
                    close_polyline()
                    feature_index = intern(feature_match.group(1))
                    continue
                z_match = _Z_COMMENT_RE.match(line)
                if z_match:
                    pending_z = float(z_match.group(1))
                    # Only a layer that has printed nothing yet is still open to
                    # being told its height; once it has geometry, a height
                    # comment belongs to the layer about to start.
                    if current is not None and not current["paths"] and not polyline:
                        current["z"] = pending_z
                continue
            if line.startswith("M82"):
                absolute_e = True
                continue
            if line.startswith("M83"):
                absolute_e = False
                continue
            if line.startswith("G92"):
                e_match = _E_RE.search(line)
                if e_match:
                    last_e = float(e_match.group(1))
                continue
            word = line.split(" ", 1)[0]
            if word not in ("G0", "G1", "G2", "G3"):
                continue
            arc_cw = word == "G2"
            arc = arc_cw or word == "G3"

            e_match = _E_RE.search(line)
            e_value = float(e_match.group(1)) if e_match else None
            if absolute_e and e_value is not None:
                extruding = e_value > last_e + 1e-9
                last_e = e_value
            else:
                extruding = e_value is not None and e_value > 0

            axes = {a: float(v) for a, v in _AXIS_RE.findall(line)}
            target = dict(pos and {"X": pos[0], "Y": pos[1]} or {})
            target.update(axes)
            if "X" not in target or "Y" not in target:
                # A pure Z lift or a stationary retract: no plate motion to draw.
                if current is not None and not extruding and _Z_MOVE_RE.search(line):
                    close_polyline()
                continue
            point = [target["X"], target["Y"]]

            if current is None:
                pos = point
                continue
            if extruding:
                if not polyline and seed is not None:
                    polyline.append(seed)
                if arc and pos is not None and "I" in axes and "J" in axes:
                    step = _arc_points(pos, point, axes["I"], axes["J"], arc_cw)
                else:
                    step = [point]
                for candidate in step:
                    # A move that does not change X or Y draws nothing; a
                    # repeated point only inflates what the renderer walks.
                    if not polyline or polyline[-1] != candidate:
                        polyline.append(candidate)
            else:
                close_polyline()
                seed = point
            pos = point

        close_layer()

    if len(layers) > max_layers:
        truncated = True
        # Sample across the whole height rather than keeping the bottom: a
        # preview that stops a third of the way up hides exactly the overhangs
        # an operator is checking for.
        stride = len(layers) / max_layers
        layers = [layers[int(i * stride)] for i in range(max_layers)]

    heights = [round(b["z"] - a["z"], 4) for a, b in zip(layers, layers[1:])]
    positive = [h for h in heights if h > 0]
    layer_height = min(positive) if positive else (round(layers[0]["z"], 4) if layers else 0.0)
    return {
        "layer_height_mm": layer_height,
        "layers": layers,
        "truncated": truncated,
        "features": features,
    }


def read_result_json(directory: Path) -> dict | None:
    """The CLI writes `result.json` into its working directory. It is the only
    channel that reports a failure: the binary is linked as a GUI subsystem
    application on Windows and writes nothing to a captured stdout."""
    import json

    path = Path(directory) / RESULT_JSON
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except ValueError:
        return None


def _is_failure(text: str) -> bool:
    """`error_string` is populated on success too, with the word "Success." —
    reading it as an error turns every good slice into a reported failure."""
    return bool(text) and text.strip().rstrip(".").lower() not in {"success", "ok", ""}


def merge_slice_result(run: dict, result_json: dict | None) -> dict:
    """Fold the CLI's own report into what `slicer.slice_model` observed.

    `return_code` here is the slicer's verdict on the slice; the process exit
    code says only that the binary ran, so this one wins when they disagree.
    """
    merged = dict(run)
    if not result_json:
        return merged
    merged["result"] = result_json

    warnings = result_json.get("warning") or result_json.get("warnings") or []
    if not isinstance(warnings, list):
        warnings = [str(warnings)]
    for plate in result_json.get("sliced_plates") or []:
        message = plate.get("warning_message") if isinstance(plate, dict) else None
        if message:
            warnings.append(str(message))
    merged["warnings"] = warnings

    code = result_json.get("return_code")
    error = result_json.get("error") or result_json.get("error_string") or ""
    failed = (code is not None and code != 0) or _is_failure(str(error))
    if failed:
        merged["error"] = str(error) or f"slicer returned {code}"
        merged["ok"] = False
    return merged
