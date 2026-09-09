"""Execute a PARAMS+build() CAD script and export STL/GLB/STEP + manifest.

Three writers can target the same case: the app's parameter sidebar, the app's
file watcher, and the agent's `cad_run` MCP tool — in three different
processes. They are serialized with a lock file per script, and every artifact
is written to a temp file and renamed into place, so a reader never sees a mesh
that disagrees with its manifest or a half-written file.
"""
import hashlib, importlib.util, json, os, sys, time, traceback
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from build123d import Mesher, export_step, export_stl
import trimesh

# A build of a large part can take a while; anything older than this is a
# crashed run, not a live one.
LOCK_STALE_SECONDS = 600
LOCK_POLL_SECONDS = 0.25


class _ScriptLock:
    """Cross-process mutex via O_EXCL create — no third-party dependency."""

    def __init__(self, path: Path, timeout: float = LOCK_STALE_SECONDS):
        self.path = path
        self.timeout = timeout
        self.acquired = False

    def __enter__(self):
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                self.acquired = True
                return self
            except FileExistsError:
                try:
                    age = time.time() - self.path.stat().st_mtime
                except OSError:
                    continue  # holder released between the failure and the stat
                if age > LOCK_STALE_SECONDS:
                    self.path.unlink(missing_ok=True)  # crashed run; take over
                    continue
                if time.monotonic() > deadline:
                    raise TimeoutError(f"another build is still holding {self.path}")
                time.sleep(LOCK_POLL_SECONDS)

    def __exit__(self, *exc):
        if self.acquired:
            self.path.unlink(missing_ok=True)
        return False


def _write_atomic(target: Path, write: "callable[[Path], None]") -> None:
    """Produce the artifact beside its target, then rename it into place."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        write(tmp)
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


def _export_3mf(part, path: Path) -> None:
    """3MF straight from the B-rep (lib3mf ships with build123d), so Bambu
    Studio gets explicit millimeter units instead of guessing at an STL.
    Mesher.write demands a .3mf suffix, which _write_atomic's .tmp names don't
    have — render to bytes and place them at whatever path the caller chose."""
    mesher = Mesher()  # Unit.MM is the default
    mesher.add_shape(part)
    stream = BytesIO()
    mesher.write_stream(stream, "3mf")
    path.write_bytes(stream.getvalue())


def _load_module(script: Path):
    spec = importlib.util.spec_from_file_location(script.stem, script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _validated_params(schema: dict, overrides: dict | None) -> dict:
    values = {}
    overrides = overrides or {}
    unknown = set(overrides) - set(schema)
    if unknown:
        raise ValueError(f"unknown params: {sorted(unknown)}")
    for name, meta in schema.items():
        v = overrides.get(name, meta["default"])
        if not (meta["min"] <= v <= meta["max"]):
            raise ValueError(f"{name}={v} outside [{meta['min']}, {meta['max']}]")
        values[name] = v
    return values


def _last_built_params(manifest_path: Path, schema: dict) -> dict:
    """Values from the previous build, kept across source edits so a re-run
    never silently reverts the part to defaults. The script may have changed
    underneath, so anything the new schema rejects is dropped instead of
    failing the build — unlike an explicit call, where a bad name is an error.
    """
    try:
        recorded = json.loads(manifest_path.read_text(encoding="utf-8")).get("params", {})
    except (OSError, json.JSONDecodeError):
        return {}
    reused = {}
    for name, meta in schema.items():
        entry = recorded.get(name)
        if not isinstance(entry, dict) or "value" not in entry:
            continue
        value = entry["value"]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if meta["min"] <= value <= meta["max"]:
            reused[name] = value
    return reused


def run_script(script_path: str, overrides: dict | None = None, reuse: bool = False) -> dict:
    script = Path(script_path).resolve()
    case = script.parent.parent          # <case>/cad/<name>.py -> <case>
    name = script.stem
    manifest_path = case / "cad" / f"{name}.manifest.json"
    manifest = {
        "script": f"cad/{script.name}", "name": name, "params": {},
        "outputs": {"stl": f"meshes/{name}.stl", "glb": f"meshes/{name}.glb",
                    "3mf": f"meshes/{name}.3mf", "step": f"cad/{name}.step"},
        "bbox_mm": None, "volume_mm3": None, "watertight": None,
        "generated_at": datetime.now(timezone.utc).isoformat(), "error": None,
    }
    try:
        # Held across build AND export: the manifest must always describe the
        # mesh that is on disk when the lock is released.
        with _ScriptLock(case / "cad" / f".{name}.lock"):
            mod = _load_module(script)
            if reuse and not overrides:
                overrides = _last_built_params(manifest_path, mod.PARAMS)
            values = _validated_params(mod.PARAMS, overrides)
            manifest["params"] = {
                k: {**mod.PARAMS[k], "value": values[k]} for k in mod.PARAMS
            }
            part = mod.build(values)
            stl_path = case / manifest["outputs"]["stl"]
            _write_atomic(stl_path, lambda p: export_stl(part, str(p)))
            _write_atomic(case / manifest["outputs"]["step"], lambda p: export_step(part, str(p)))
            _write_atomic(case / manifest["outputs"]["3mf"], lambda p: _export_3mf(part, p))
            tm = trimesh.load(str(stl_path))
            _write_atomic(case / manifest["outputs"]["glb"], lambda p: tm.export(str(p), file_type="glb"))
            manifest["bbox_mm"] = [float(x) for x in tm.extents]
            manifest["volume_mm3"] = float(abs(tm.volume))
            manifest["watertight"] = bool(tm.is_watertight)
            _write_atomic(manifest_path, lambda p: p.write_text(json.dumps(manifest, indent=2), encoding="utf-8"))
            return manifest
    except Exception as e:  # noqa: BLE001 — manifest carries the error to the UI
        manifest["error"] = f"{type(e).__name__}: {e}"
        traceback.print_exc(file=sys.stderr)
    # Failures still record why, but never clobber a good build's geometry.
    _write_atomic(manifest_path, lambda p: p.write_text(json.dumps(manifest, indent=2), encoding="utf-8"))
    return manifest
