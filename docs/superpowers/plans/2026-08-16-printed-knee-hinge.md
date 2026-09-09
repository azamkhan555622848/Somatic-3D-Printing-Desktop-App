# Printed Knee Hinge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully 3D-printed single-axis ROM knee hinge with printed uprights, and the cuff interface rework that all-printed construction forces.

**Architecture:** Two flat plates joined by a Ø22 mm boss-in-bore pivot with a bayonet flange for retention — no pin, no fastener. A follower lug on the calf plate travels in an arc slot on the thigh plate; two removable pegs dropped into indexed holes bracket the lug and set the range of motion. Uprights are solid printed bars. The cuff's metal-fastener boss becomes a dovetail socket with a printed taper wedge.

**Tech Stack:** Python 3.12, build123d (algebra API), OCCT. Pure geometry maths in `lib/` with pytest; everything touching OCCT verified by measuring the exported mesh with trimesh.

**Spec:** `docs/superpowers/specs/2026-08-16-printed-knee-hinge-design.md`

## Global Constraints

- **Case folder:** `cases/knee-brace/`. Scripts in `cad/`, shared maths in `lib/`.
- **CRITICAL — never put a helper module or test file in `cad/`.** The app treats every `.py` directly inside a `cad/` folder as a buildable CAD script (`core.ts`: `SOURCE_RE = /(^|[\\/])cad[\\/][^\\/]+\.(py|params\.json)$/i`) and re-runs it on every edit. A helper there is auto-built, fails for having no `PARAMS`, and leaves a permanently broken script in the case browser. `lib/` is invisible to that pattern.
- **Convention:** module-level `PARAMS` dict (`default`/`min`/`max`/`step`/`unit`) plus `build(p)` returning **one solid**.
- **Build volume:** every part inside **256 × 256 × 260 mm**.
- **Minimum wall:** **1.2 mm** anywhere (0.4 mm nozzle).
- **Material:** PETG throughout. No metal parts of any kind — no bolts, pins, screws or rivets.
- **Interpreters:** `C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe` has build123d; `C:/Users/azamk/Documents/3D-Coder/mesh-mcp/.venv/Scripts/python.exe` has trimesh. Different environments.
- **Commits:** conventional, scoped `feat(3d-coder):` / `test(3d-coder):`, in the `Documents` repo. **Never add a Co-Authored-By or "Generated with" trailer.**
- **`3D-Coder/scratch` is gitignored** — never list a scratch path in a `git add`, it aborts the whole commit.
- **OCCT traps already paid for in this project:**
  1. `loft()` defaults to a smooth spline and undershoots badly when end sections have steep slopes — pass `ruled=True` for straight tapers.
  2. A profile terminating **on** the axis of revolution tessellates to a degenerate triangle and a non-watertight STL. Stop short and close with a micro-flat.
  3. A cutting tool centred on the axis spans the full diameter and punches the **opposite** wall too. Run tools from the axis outward: `Rot(0,0,ang) * Pos(reach/2,0,z) * Box(reach,...)`.
  4. A loft between wires of differing vertex counts makes OCCT crawl.
  5. `part.is_valid` is a **method** — reading it without calling is always truthy and checks nothing.
  6. A single non-converging fillet radius hangs OCCT forever with no in-process guard on Windows. Keep fillet ladders short.

## File Structure

| File | Responsibility |
|---|---|
| `cases/knee-brace/lib/hinge_math.py` | Pure maths — bayonet lug/slot angles, stop arc geometry, peg hole bearings, fit clearances. No build123d import. |
| `cases/knee-brace/lib/test_hinge_math.py` | pytest for the above. |
| `cases/knee-brace/cad/hinge_thigh.py` | `PARAMS` + `build(p)` — thigh plate: boss, bayonet flange, arc slot, peg holes. |
| `cases/knee-brace/cad/hinge_calf.py` | `PARAMS` + `build(p)` — calf plate: bore, keyhole relief, follower lug. |
| `cases/knee-brace/cad/stop_peg.py` | `PARAMS` + `build(p)` — the removable stop peg. |
| `cases/knee-brace/cad/upright.py` | `PARAMS` + `build(p)` — printed bar, hinge end and cuff dovetail tongue. |
| `cases/knee-brace/cad/wedge.py` | `PARAMS` + `build(p)` — taper wedge locking the dovetail. |
| `cases/knee-brace/cad/cuff.py` | **Modified** — boss becomes a dovetail socket; fastener params removed. |
| `scratch/hinge_verify.py` | Throwaway mesh measurement. **Gitignored — never in a `git add`.** |

**Why the two plates are separate scripts:** they are two separately printed
parts, and the app builds one part per script. They share pivot geometry, so
every shared dimension lives in `hinge_math.py` and both scripts import it. The
residual hazard — a user setting `pivot_diameter` differently in each sidebar —
is caught in Task 6 by measuring the actual exported pair rather than trusting
the parameters.

**Coordinate system, all hinge parts:** pivot axis is **Z**, plates lie in the
**XY** plane so they print flat with layers in the plate plane. The thigh plate
extends toward **+Y**, the calf plate toward **−Y**. Angles are measured
counter-clockwise from +Y, so 0° is full extension.

---

### Task 1: Bayonet and stop geometry maths

**Files:**
- Create: `cases/knee-brace/lib/hinge_math.py`
- Test: `cases/knee-brace/lib/test_hinge_math.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `lug_spans(count: int, fill: float) -> list[tuple[float, float]]` returning `(start_deg, end_deg)` pairs; `release_angle(count: int) -> float`; `peg_bearings(range_deg: float, increment_deg: float) -> list[float]`.

- [ ] **Step 1: Write the failing test**

Create `cases/knee-brace/lib/test_hinge_math.py`:

```python
import pytest

from hinge_math import lug_spans, peg_bearings, release_angle


def test_three_lugs_evenly_spaced_each_filling_half_its_sector():
    spans = lug_spans(3, 0.5)
    assert len(spans) == 3
    assert spans[0] == pytest.approx((0.0, 60.0))
    assert spans[1] == pytest.approx((120.0, 180.0))
    assert spans[2] == pytest.approx((240.0, 300.0))


def test_lug_fill_controls_lug_width():
    # fill 0.5 of a 120 deg sector is a 60 deg lug; 0.25 is a 30 deg lug
    assert lug_spans(3, 0.25)[0] == pytest.approx((0.0, 30.0))


def test_release_angle_is_half_a_sector_so_lugs_sit_over_the_gaps():
    # rotate by half a sector and every lug is clear of every relief slot
    assert release_angle(3) == pytest.approx(60.0)
    assert release_angle(4) == pytest.approx(45.0)


def test_peg_bearings_span_the_range_at_the_increment():
    bearings = peg_bearings(120.0, 10.0)
    assert bearings[0] == pytest.approx(0.0)
    assert bearings[-1] == pytest.approx(120.0)
    assert len(bearings) == 13


def test_increment_must_divide_the_range():
    with pytest.raises(ValueError):
        peg_bearings(100.0, 30.0)


def test_lug_fill_must_leave_a_gap_to_pass_through():
    with pytest.raises(ValueError):
        lug_spans(3, 1.0)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/lib
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -m pytest test_hinge_math.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'hinge_math'`

- [ ] **Step 3: Write minimal implementation**

Create `cases/knee-brace/lib/hinge_math.py`:

```python
"""Pure geometry maths for the printed knee hinge.

No build123d import: this is the part testable in milliseconds rather than
behind an OCCT build.
"""


def lug_spans(count, fill):
    """Angular spans of the bayonet flange lugs, in degrees.

    The flange is divided into `count` equal sectors; each lug fills `fill` of
    its sector and the remainder is the gap the mating relief slot passes
    through. fill must be under 1.0 or there is no gap and the parts cannot be
    assembled at all.
    """
    if count < 2:
        raise ValueError(f"need at least 2 lugs for a balanced bayonet, got {count}")
    if not 0.0 < fill < 1.0:
        raise ValueError(f"lug fill must be between 0 and 1 exclusive, got {fill}")
    sector = 360.0 / count
    return [(i * sector, i * sector + sector * fill) for i in range(count)]


def release_angle(count):
    """Rotation from the captured position back to where the lugs line up with
    the relief slots. Half a sector puts every lug centred over a gap."""
    if count < 2:
        raise ValueError(f"need at least 2 lugs, got {count}")
    return 360.0 / count / 2.0


def peg_bearings(range_deg, increment_deg):
    """Bearings of the indexed peg holes along the arc slot, 0 = full extension.

    The increment has to divide the range exactly, otherwise the last hole
    lands off the end of the slot and the maximum flexion stop silently is not
    where the label says.
    """
    if range_deg <= 0.0:
        raise ValueError(f"range must be positive, got {range_deg}")
    if increment_deg <= 0.0:
        raise ValueError(f"increment must be positive, got {increment_deg}")
    steps = range_deg / increment_deg
    if abs(steps - round(steps)) > 1e-9:
        raise ValueError(
            f"increment {increment_deg} does not divide range {range_deg} exactly"
        )
    return [i * increment_deg for i in range(int(round(steps)) + 1)]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/lib
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -m pytest test_hinge_math.py -v
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/lib/hinge_math.py 3D-Coder/workspace/cases/knee-brace/lib/test_hinge_math.py
git commit -m "feat(3d-coder): bayonet and stop geometry maths for the printed hinge"
```

---

### Task 2: Thigh plate — body, boss and bayonet flange

**Files:**
- Create: `cases/knee-brace/cad/hinge_thigh.py`

**Interfaces:**
- Consumes: `lug_spans`, `release_angle` from Task 1.
- Produces: `PARAMS` with keys `pivot_diameter`, `pivot_clearance`, `plate_thickness`, `plate_radius`, `arm_length`, `arm_width`, `flange_height`, `lug_count`, `lug_fill`; `build(p)` returning one solid.

- [ ] **Step 1: Write the script**

Create `cases/knee-brace/cad/hinge_thigh.py`:

```python
"""Printed knee hinge - THIGH plate (boss side), build123d algebra API.

Coordinate system (mm):
    Z = pivot axis and plate thickness. The plate lies in XY so it prints flat
        with layers in the plate plane, keeping bending and bearing loads
        in-plane rather than peeling layers apart.
    +Y = proximal, toward the thigh cuff. Angles run counter-clockwise from +Y,
        so 0 deg is full extension.

The pivot is a large boss, NOT a pin. Shear stress in a pin scales with 1/d^2
and a printed pin is loaded in single shear at the joint line with its layer
planes as candidate failure surfaces. A 22 mm boss drops bearing and shear
stress by more than an order of magnitude for the same load.
"""
import math
import sys
from pathlib import Path

from build123d import Align, Box, Cylinder, Polyline, Pos, extrude, make_face

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))
from hinge_math import lug_spans  # noqa: E402

PARAMS = {
    "pivot_diameter": {"default": 22.0, "min": 14, "max": 34, "step": 0.5, "unit": "mm"},
    # The single most likely value to change after the first test print: too
    # tight binds, too loose lets the joint rock, and slop on a 22 mm boss shows
    # up magnified at the ankle.
    "pivot_clearance": {"default": 0.35, "min": 0.1, "max": 1.0, "step": 0.05, "unit": "mm"},
    "plate_thickness": {"default": 6.0, "min": 3, "max": 12, "step": 0.5, "unit": "mm"},
    "plate_radius": {"default": 30.0, "min": 20, "max": 50, "step": 1, "unit": "mm"},
    "arm_length": {"default": 60.0, "min": 30, "max": 120, "step": 5, "unit": "mm"},
    "arm_width": {"default": 20.0, "min": 12, "max": 34, "step": 1, "unit": "mm"},
    "flange_height": {"default": 3.0, "min": 2, "max": 6, "step": 0.5, "unit": "mm"},
    "lug_count": {"default": 3, "min": 2, "max": 6, "step": 1, "unit": ""},
    "lug_fill": {"default": 0.5, "min": 0.25, "max": 0.75, "step": 0.05, "unit": ""},
}

BUILD_VOLUME_MM = (256.0, 256.0, 260.0)
MIN_WALL_MM = 1.2


def _plate(p):
    """Disc at the pivot plus an arm running proximally to the cuff."""
    disc = Cylinder(p["plate_radius"], p["plate_thickness"],
                    align=(Align.CENTER, Align.CENTER, Align.MIN))
    arm = Pos(0, p["arm_length"] / 2.0, p["plate_thickness"] / 2.0) * Box(
        p["arm_width"], p["arm_length"], p["plate_thickness"]
    )
    return disc + arm


def _boss(p):
    """Pivot boss standing proud of the plate, tall enough to pass through the
    calf plate and present its flange above it."""
    height = p["plate_thickness"] + p["pivot_clearance"]
    return Pos(0, 0, p["plate_thickness"]) * Cylinder(
        p["pivot_diameter"] / 2.0, height, align=(Align.CENTER, Align.CENTER, Align.MIN)
    )


def _flange(p):
    """Bayonet lugs on top of the boss.

    Built as pie sectors rather than a full disc: the gaps between them are what
    the mating relief slots pass through. Each sector is a polygon whose curved
    edge sits outside the flange radius, so only its straight flanks touch
    geometry - a cheap, robust way to cut a pie without arc primitives.
    """
    r_flange = p["pivot_diameter"] / 2.0 + 3.0
    z0 = p["plate_thickness"] + p["plate_thickness"] + p["pivot_clearance"]
    lugs = None
    for start, end in lug_spans(int(p["lug_count"]), p["lug_fill"]):
        pts = [(0.0, 0.0)]
        span = end - start
        for i in range(17):
            ang = math.radians(start + span * i / 16.0)
            pts.append((r_flange * math.sin(ang), r_flange * math.cos(ang)))
        face = make_face(Polyline(*pts, close=True).edges())
        lug = Pos(0, 0, z0) * extrude(face, amount=p["flange_height"])
        lugs = lug if lugs is None else lugs + lug
    return lugs


def build(p):
    assert p["plate_thickness"] >= MIN_WALL_MM, (
        f"plate_thickness {p['plate_thickness']:.2f} mm is under the {MIN_WALL_MM} mm minimum"
    )
    part = _plate(p) + _boss(p) + _flange(p)

    assert len(part.solids()) == 1, f"expected 1 solid, got {len(part.solids())}"
    valid = part.is_valid
    assert bool(valid() if callable(valid) else valid), "OCCT reports an invalid solid"
    bb = part.bounding_box()
    for axis, size, limit in zip("XYZ", (bb.size.X, bb.size.Y, bb.size.Z), BUILD_VOLUME_MM):
        assert size <= limit, f"{axis} extent {size:.1f} mm exceeds the {limit:.0f} mm build volume"
    return part
```

- [ ] **Step 2: Build it**

Call the `cad` MCP tool `cad_run` with `script_path` = `cases/knee-brace/cad/hinge_thigh.py`.

Expected: `error` null, `watertight` true, one solid. Bounding box roughly
`[60, 90, 18]` — X is the plate diameter, Y is plate radius plus arm, Z is plate
thickness plus boss plus flange.

- [ ] **Step 4: Verify the boss diameter off the mesh**

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe -c "import trimesh, numpy as np; m=trimesh.load(r'C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes\hinge_thigh.stl'); s=m.section(plane_origin=[0,0,9], plane_normal=[0,0,1]); r=np.hypot(s.vertices[:,0], s.vertices[:,1]); print('boss OD at mid-height:', round(r.max()*2, 3))"
```

Expected: approximately 22.0 mm. If it reads 28 the section landed in the
flange — raise the Z height.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/hinge_thigh.py
git commit -m "feat(3d-coder): printed hinge thigh plate with boss and bayonet flange"
```

---

### Task 3: Calf plate — body, bore and keyhole relief

**Files:**
- Create: `cases/knee-brace/cad/hinge_calf.py`

**Interfaces:**
- Consumes: `lug_spans` from Task 1; the boss geometry from Task 2 (same `pivot_diameter`, `pivot_clearance`, `flange_height`, `lug_count`, `lug_fill` keys and defaults).
- Produces: `PARAMS` + `build(p)` returning one solid.

- [ ] **Step 1: Write the script**

Create `cases/knee-brace/cad/hinge_calf.py`:

```python
"""Printed knee hinge - CALF plate (bore side), build123d algebra API.

Same axis convention as hinge_thigh.py: pivot on Z, plate in XY, printed flat.
The arm runs to -Y (distal, toward the calf cuff).

Shares every pivot dimension with the thigh plate through hinge_math and
identical PARAMS defaults. Task 6 measures the exported pair rather than
trusting that they were driven with matching values.
"""
import math
import sys
from pathlib import Path

from build123d import Align, Box, Cylinder, Polyline, Pos, extrude, make_face

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))
from hinge_math import lug_spans  # noqa: E402

PARAMS = {
    "pivot_diameter": {"default": 22.0, "min": 14, "max": 34, "step": 0.5, "unit": "mm"},
    "pivot_clearance": {"default": 0.35, "min": 0.1, "max": 1.0, "step": 0.05, "unit": "mm"},
    "plate_thickness": {"default": 6.0, "min": 3, "max": 12, "step": 0.5, "unit": "mm"},
    "plate_radius": {"default": 30.0, "min": 20, "max": 50, "step": 1, "unit": "mm"},
    "arm_length": {"default": 60.0, "min": 30, "max": 120, "step": 5, "unit": "mm"},
    "arm_width": {"default": 20.0, "min": 12, "max": 34, "step": 1, "unit": "mm"},
    "flange_height": {"default": 3.0, "min": 2, "max": 6, "step": 0.5, "unit": "mm"},
    "lug_count": {"default": 3, "min": 2, "max": 6, "step": 1, "unit": ""},
    "lug_fill": {"default": 0.5, "min": 0.25, "max": 0.75, "step": 0.05, "unit": ""},
}

BUILD_VOLUME_MM = (256.0, 256.0, 260.0)
MIN_WALL_MM = 1.2
RELIEF_MARGIN_DEG = 4.0   # extra opening each side so the lug is not a press fit


def _plate(p):
    disc = Cylinder(p["plate_radius"], p["plate_thickness"],
                    align=(Align.CENTER, Align.CENTER, Align.MIN))
    arm = Pos(0, -p["arm_length"] / 2.0, p["plate_thickness"] / 2.0) * Box(
        p["arm_width"], p["arm_length"], p["plate_thickness"]
    )
    return disc + arm


def _bore(p):
    """Running bore for the boss, plus the keyhole relief the flange lugs pass
    through at the release angle."""
    r_bore = p["pivot_diameter"] / 2.0 + p["pivot_clearance"] / 2.0
    tall = p["plate_thickness"] + 4.0
    cut = Pos(0, 0, -2.0) * Cylinder(r_bore, tall, align=(Align.CENTER, Align.CENTER, Align.MIN))

    r_relief = p["pivot_diameter"] / 2.0 + 3.0 + p["pivot_clearance"] / 2.0
    for start, end in lug_spans(int(p["lug_count"]), p["lug_fill"]):
        pts = [(0.0, 0.0)]
        span = (end - start) + 2.0 * RELIEF_MARGIN_DEG
        base = start - RELIEF_MARGIN_DEG
        for i in range(17):
            ang = math.radians(base + span * i / 16.0)
            pts.append((r_relief * math.sin(ang), r_relief * math.cos(ang)))
        face = make_face(Polyline(*pts, close=True).edges())
        cut = cut + Pos(0, 0, -2.0) * extrude(face, amount=tall)
    return cut


def build(p):
    assert p["plate_thickness"] >= MIN_WALL_MM, (
        f"plate_thickness {p['plate_thickness']:.2f} mm is under the {MIN_WALL_MM} mm minimum"
    )
    part = _plate(p) - _bore(p)

    assert len(part.solids()) == 1, f"expected 1 solid, got {len(part.solids())}"
    valid = part.is_valid
    assert bool(valid() if callable(valid) else valid), "OCCT reports an invalid solid"
    bb = part.bounding_box()
    for axis, size, limit in zip("XYZ", (bb.size.X, bb.size.Y, bb.size.Z), BUILD_VOLUME_MM):
        assert size <= limit, f"{axis} extent {size:.1f} mm exceeds the {limit:.0f} mm build volume"
    return part
```

- [ ] **Step 2: Build it**

Call `cad_run` on `cases/knee-brace/cad/hinge_calf.py`.

Expected: `error` null, `watertight` true, one solid.

- [ ] **Step 3: Verify the bore against the boss**

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe -c "import trimesh, numpy as np; m=trimesh.load(r'C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes\hinge_calf.stl'); s=m.section(plane_origin=[0,0,3], plane_normal=[0,0,1]); r=np.hypot(s.vertices[:,0], s.vertices[:,1]); inner=r[r < 20]; print('bore ID:', round(inner.min()*2, 3))"
```

Expected: approximately 22.35 mm — the 22.0 boss plus the 0.35 clearance.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/hinge_calf.py
git commit -m "feat(3d-coder): printed hinge calf plate with bore and keyhole relief"
```

---

### Task 4: Arc slot, follower lug and peg holes

**Files:**
- Modify: `cases/knee-brace/cad/hinge_thigh.py`
- Modify: `cases/knee-brace/cad/hinge_calf.py`
- Modify: `cases/knee-brace/lib/hinge_math.py`
- Test: `cases/knee-brace/lib/test_hinge_math.py`

**Interfaces:**
- Consumes: `peg_bearings` from Task 1.
- Produces: `stop_radius(plate_radius: float) -> float` in `hinge_math`; arc slot on the thigh plate, follower lug on the calf plate, indexed peg holes on the thigh plate.

- [ ] **Step 1: Write the failing test**

Append to `cases/knee-brace/lib/test_hinge_math.py`:

```python
from hinge_math import stop_radius


def test_stop_radius_sits_inside_the_plate_with_material_left_outboard():
    r = stop_radius(30.0)
    assert 0.5 * 30.0 < r < 30.0 - 3.0


def test_stop_radius_scales_with_the_plate():
    assert stop_radius(40.0) > stop_radius(30.0)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/lib
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -m pytest test_hinge_math.py -v
```

Expected: FAIL — `ImportError: cannot import name 'stop_radius'`

- [ ] **Step 3: Implement in `hinge_math.py`**

```python
STOP_RADIUS_FRACTION = 0.72   # of plate_radius
STOP_EDGE_MARGIN_MM = 3.0     # material left outboard of the slot


def stop_radius(plate_radius):
    """Radius the arc slot and follower lug run on.

    Far enough out that the peg has leverage against the lug - stop torque is
    force times this radius, so a small radius means a large force on a printed
    peg - but with material left outboard so the slot does not open into the
    plate rim.
    """
    r = plate_radius * STOP_RADIUS_FRACTION
    return min(r, plate_radius - STOP_EDGE_MARGIN_MM)
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS, 8 tests.

- [ ] **Step 5: Add the arc slot and peg holes to the thigh plate**

In `hinge_thigh.py`, add to `PARAMS`:

```python
    "stop_range_deg": {"default": 120.0, "min": 30, "max": 140, "step": 10, "unit": "deg"},
    "stop_increment_deg": {"default": 10.0, "min": 5, "max": 30, "step": 5, "unit": "deg"},
    "peg_diameter": {"default": 5.0, "min": 3, "max": 9, "step": 0.5, "unit": "mm"},
```

Extend the `hinge_math` import to `from hinge_math import lug_spans, peg_bearings, stop_radius`, then add:

```python
SLOT_CLEARANCE_MM = 0.4    # slot width over lug width, so it runs not binds


def _arc_slot(p):
    """Through-slot the calf plate's follower lug travels in.

    Cut as a chain of overlapping cylinders along the arc rather than a swept
    profile: a sweep along a tight arc is exactly the kind of operation OCCT
    refuses or takes minutes over, and this is a cutting tool whose exact
    surface finish does not matter.
    """
    r = stop_radius(p["plate_radius"])
    width = p["peg_diameter"] + SLOT_CLEARANCE_MM
    tall = p["plate_thickness"] + 4.0
    tool = None
    steps = max(int(p["stop_range_deg"]), 1)
    for i in range(steps + 1):
        ang = math.radians(p["stop_range_deg"] * i / steps)
        x, y = r * math.sin(ang), r * math.cos(ang)
        disc = Pos(x, y, -2.0) * Cylinder(width / 2.0, tall,
                                          align=(Align.CENTER, Align.CENTER, Align.MIN))
        tool = disc if tool is None else tool + disc
    return tool


Then change `build` so the slot is cut:

```python
    part = _plate(p) + _boss(p) + _flange(p)
    part = part - _arc_slot(p)
```

**There is deliberately no separate row of peg holes.** A hole row and a slot
along the same arc at the same radius are the same cut — the peg seats directly
in the slot, and `peg_bearings` exists to tell the *operator* which bearings
correspond to which range, and to drive the assertion in Step 7 below. Cutting
both would be redundant geometry and would weaken the plate for nothing.

- [ ] **Step 6: Add the follower lug to the calf plate**

In `hinge_calf.py`, add to `PARAMS`:

```python
    "peg_diameter": {"default": 5.0, "min": 3, "max": 9, "step": 0.5, "unit": "mm"},
```

Extend the import to `from hinge_math import lug_spans, stop_radius`, and add:

```python
def _follower(p):
    """Peg-sized post standing proud of the calf plate, riding in the thigh
    plate's arc slot. The stop pegs bracket it and that bracket is the range."""
    r = stop_radius(p["plate_radius"])
    post = Cylinder(p["peg_diameter"] / 2.0, p["plate_thickness"] + 2.0,
                    align=(Align.CENTER, Align.CENTER, Align.MIN))
    return Pos(0.0, r, p["plate_thickness"]) * post
```

and in `build`, change the part line to:

```python
    part = (_plate(p) - _bore(p)) + _follower(p)
```

- [ ] **Step 7: Assert the hinge cannot separate inside its working range**

This is a safety property, not a nicety: if the bayonet release angle falls
inside the range the pegs allow, the hinge can come apart while worn. Add to
`hinge_thigh.py` `build`, after the existing asserts:

```python
    # The bayonet releases at half a lug sector from the captured position. If
    # that angle is reachable within the stop range, the plates can separate
    # while the brace is being worn - so the geometry must exclude it, not the
    # operator's care.
    release = release_angle(int(p["lug_count"]))
    assert release > p["stop_range_deg"], (
        f"bayonet releases at {release:.0f} deg, inside the {p['stop_range_deg']:.0f} deg "
        f"stop range - the hinge could come apart in use. Use more lugs "
        f"(lug_count {int(p['lug_count'])} gives {release:.0f} deg) or reduce stop_range_deg."
    )
```

and extend the import to
`from hinge_math import lug_spans, peg_bearings, release_angle, stop_radius`.

**Note this will fail at the default values** — 3 lugs release at 60°, and the
default `stop_range_deg` is 120°. That is the assertion doing its job on a real
conflict I did not catch when sizing the defaults. Resolve it by raising
`lug_count` until the release angle clears the range: 3 lugs give 60°, 2 lugs
give 90°, and neither clears 120°.

Since more lugs make it *worse*, the fix is the other direction — the release
angle must be moved out of the range by **offsetting the relief slots**, not by
lug count. Change `_bore` in `hinge_calf.py` to rotate its relief cutouts by a
fixed `RELIEF_OFFSET_DEG = 150.0`, so assembly happens at 150° of flexion — well
outside any clinical range — and set the assert to compare against that constant
instead:

```python
RELIEF_OFFSET_DEG = 150.0   # assembly angle, deliberately outside any usable range
```

In `_bore`, add `RELIEF_OFFSET_DEG` to `base`. In `hinge_thigh.build`, assert
`RELIEF_OFFSET_DEG > p["stop_range_deg"]` with the same message. Import the
constant from `hinge_math` so both plates share one definition rather than two
copies that can drift.

- [ ] **Step 8: Build both and verify**

Call `cad_run` on both scripts. Expected for each: `error` null, `watertight`
true, one solid, and the release-angle assert passing at the default 120° range.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/hinge_thigh.py 3D-Coder/workspace/cases/knee-brace/cad/hinge_calf.py 3D-Coder/workspace/cases/knee-brace/lib/hinge_math.py 3D-Coder/workspace/cases/knee-brace/lib/test_hinge_math.py
git commit -m "feat(3d-coder): arc slot, follower lug and indexed stops on the printed hinge"
```

---

### Task 5: Stop peg

**Files:**
- Create: `cases/knee-brace/cad/stop_peg.py`

**Interfaces:**
- Consumes: `peg_diameter`, `plate_thickness` conventions from Tasks 2–4.
- Produces: `PARAMS` + `build(p)` returning one solid.

- [ ] **Step 1: Write the script**

Create `cases/knee-brace/cad/stop_peg.py`:

```python
"""Printed knee hinge - removable STOP PEG.

Two of these drop into the thigh plate's arc slot and bracket the calf plate's
follower, and the bracket is the range of motion. They exist because the bayonet
must be assembled at an angle that solid printed stops would make unreachable -
so the stops have to be separate parts, and once they are separate, where they
sit is adjustable.

Printed standing (axis on Z) so the loaded cross-section is intra-layer rather
than an interlayer bond: the stop load is shear across the peg.
"""
from build123d import Align, Cylinder, Pos

PARAMS = {
    "peg_diameter": {"default": 5.0, "min": 3, "max": 9, "step": 0.5, "unit": "mm"},
    "peg_clearance": {"default": 0.25, "min": 0.05, "max": 0.8, "step": 0.05, "unit": "mm"},
    "plate_thickness": {"default": 6.0, "min": 3, "max": 12, "step": 0.5, "unit": "mm"},
    "head_diameter": {"default": 9.0, "min": 6, "max": 16, "step": 0.5, "unit": "mm"},
    "head_height": {"default": 2.5, "min": 1.5, "max": 5, "step": 0.5, "unit": "mm"},
}

BUILD_VOLUME_MM = (256.0, 256.0, 260.0)
MIN_WALL_MM = 1.2


def build(p):
    assert p["head_diameter"] > p["peg_diameter"], (
        f"head {p['head_diameter']:.1f} mm must be wider than the shank "
        f"{p['peg_diameter']:.1f} mm or the peg drops straight through the slot"
    )
    shank_d = p["peg_diameter"] - p["peg_clearance"]
    assert shank_d >= MIN_WALL_MM, (
        f"shank {shank_d:.2f} mm is under the {MIN_WALL_MM} mm minimum"
    )

    shank = Cylinder(shank_d / 2.0, p["plate_thickness"] + 1.0,
                     align=(Align.CENTER, Align.CENTER, Align.MIN))
    head = Pos(0, 0, p["plate_thickness"] + 1.0) * Cylinder(
        p["head_diameter"] / 2.0, p["head_height"],
        align=(Align.CENTER, Align.CENTER, Align.MIN)
    )
    part = shank + head

    assert len(part.solids()) == 1, f"expected 1 solid, got {len(part.solids())}"
    valid = part.is_valid
    assert bool(valid() if callable(valid) else valid), "OCCT reports an invalid solid"
    bb = part.bounding_box()
    for axis, size, limit in zip("XYZ", (bb.size.X, bb.size.Y, bb.size.Z), BUILD_VOLUME_MM):
        assert size <= limit, f"{axis} extent {size:.1f} mm exceeds the {limit:.0f} mm build volume"
    return part
```

- [ ] **Step 2: Build and verify**

Call `cad_run` on `cases/knee-brace/cad/stop_peg.py`.

Expected: `error` null, `watertight` true, one solid, bbox about `[9, 9, 9.5]`.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/stop_peg.py
git commit -m "feat(3d-coder): removable stop peg for the printed hinge"
```

---

### Task 6: Assembly verification

**Files:**
- Create: `scratch/hinge_verify.py` (**gitignored — never in a `git add`**)

This task writes no part. It checks that the three printed parts actually go
together, by measuring the exported meshes rather than trusting that both
sidebars were driven with matching parameters.

- [ ] **Step 1: Write the verifier**

Create `scratch/hinge_verify.py`:

```python
"""Throwaway: do the printed hinge parts actually fit each other?

Measures the exported meshes. The two plates are separate scripts with separate
sidebars, so nothing stops a user setting pivot_diameter differently in each -
only measuring the real pair catches that.
"""
import numpy as np
import trimesh

CASE = r"C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes"
PLATE_T = 6.0
EXPECTED_CLEARANCE = 0.35

thigh = trimesh.load(rf"{CASE}\hinge_thigh.stl")
calf = trimesh.load(rf"{CASE}\hinge_calf.stl")
peg = trimesh.load(rf"{CASE}\stop_peg.stl")

for name, m in (("thigh", thigh), ("calf", calf), ("peg", peg)):
    print(f"{name:6s} watertight={m.is_watertight}  bbox={np.round(m.extents, 2).tolist()}")

# Boss OD: section the thigh plate just above the plate face, inside the boss.
s = thigh.section(plane_origin=[0, 0, PLATE_T + 1.0], plane_normal=[0, 0, 1])
r = np.hypot(s.vertices[:, 0], s.vertices[:, 1])
boss_od = r[r < 20.0].max() * 2.0

# Bore ID: section the calf plate mid-thickness, take the innermost ring.
s = calf.section(plane_origin=[0, 0, PLATE_T / 2.0], plane_normal=[0, 0, 1])
r = np.hypot(s.vertices[:, 0], s.vertices[:, 1])
bore_id = r[r < 20.0].min() * 2.0

fit = bore_id - boss_od
print(f"\nboss OD {boss_od:.3f}  bore ID {bore_id:.3f}  running fit {fit:.3f} mm")
print(f"  -> {'PASS' if 0.15 <= fit <= 0.9 else 'FAIL'} (want ~{EXPECTED_CLEARANCE})")

# Peg shank must enter the slot, head must not.
s = peg.section(plane_origin=[0, 0, 1.0], plane_normal=[0, 0, 1])
shank_d = np.hypot(s.vertices[:, 0], s.vertices[:, 1]).max() * 2.0
head_d = peg.extents[0]
print(f"peg shank {shank_d:.3f}  head {head_d:.3f}")
print(f"  -> {'PASS' if head_d > shank_d + 1.0 else 'FAIL'} (head must not pass the slot)")
```

- [ ] **Step 2: Run it**

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe -u scratch/hinge_verify.py
```

Expected: all three watertight, running fit within 0.15–0.9 mm, peg head wider
than shank.

- [ ] **Step 3: Render and look**

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe scratch/nose_sheet.py "thigh=C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes\hinge_thigh.stl" "calf=C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes\hinge_calf.stl"
```

Read `scratch/nose_sheet.png`. Confirm by eye: boss and flange lugs on the thigh
plate, bore with matching relief cutouts on the calf plate, arc slot visible, and
the follower post standing proud.

- [ ] **Step 4: Commit**

Nothing to commit — `scratch/` is gitignored. Report the measurements instead.

---

### Task 7: Printed upright

**Files:**
- Create: `cases/knee-brace/cad/upright.py`

**Interfaces:**
- Consumes: `arm_width` and `plate_thickness` conventions from Tasks 2–3.
- Produces: `PARAMS` + `build(p)` returning one solid, with a dovetail tongue at the cuff end.

- [ ] **Step 1: Write the script**

Create `cases/knee-brace/cad/upright.py`:

```python
"""Printed knee brace UPRIGHT - the span from cuff to hinge plate.

Sized from stiffness, not from the aluminium bar it replaces. PETG is about
2 GPa against aluminium's 69, roughly 34x less, and bending stiffness goes as
thickness cubed - so matching a 3.2 mm aluminium bar at the same width needs
about cbrt(34) ~ 3.2x the thickness, hence 11 mm. The printed brace is bulkier
than a commercial one; that is a consequence to design to, not a fault.

Solid section, not ribbed. A ribbed section is better stiffness per gram and is
the obvious next optimisation, but it adds thin webs and fit tolerances and mass
is not worth optimising before the hinge is proven.

Printed flat, long axis in the bed plane, so bending acts across layers rather
than peeling them apart.
"""
from build123d import Align, Box, Pos

PARAMS = {
    "upright_length": {"default": 120.0, "min": 60, "max": 220, "step": 5, "unit": "mm"},
    "upright_width": {"default": 20.0, "min": 12, "max": 34, "step": 1, "unit": "mm"},
    "upright_thickness": {"default": 11.0, "min": 6, "max": 18, "step": 0.5, "unit": "mm"},
    "tongue_length": {"default": 25.0, "min": 12, "max": 50, "step": 1, "unit": "mm"},
    "tongue_taper": {"default": 3.0, "min": 1, "max": 8, "step": 0.5, "unit": "mm"},
}

BUILD_VOLUME_MM = (256.0, 256.0, 260.0)
MIN_WALL_MM = 1.2


def build(p):
    assert p["upright_thickness"] >= MIN_WALL_MM, (
        f"upright_thickness {p['upright_thickness']:.2f} mm is under the "
        f"{MIN_WALL_MM} mm minimum"
    )
    assert p["tongue_length"] < p["upright_length"], (
        f"tongue {p['tongue_length']:.0f} mm is longer than the upright "
        f"{p['upright_length']:.0f} mm"
    )

    bar = Box(p["upright_width"], p["upright_length"], p["upright_thickness"],
              align=(Align.CENTER, Align.MIN, Align.MIN))

    # Dovetail tongue at the distal end: narrower at its tip so it wedges into
    # the cuff socket instead of sliding straight back out.
    narrow = p["upright_width"] - 2.0 * p["tongue_taper"]
    assert narrow >= MIN_WALL_MM * 3, (
        f"tongue_taper {p['tongue_taper']:.1f} mm leaves a {narrow:.1f} mm tip - too thin"
    )
    tongue = Pos(0, -p["tongue_length"], 0) * Box(
        narrow, p["tongue_length"], p["upright_thickness"],
        align=(Align.CENTER, Align.MIN, Align.MIN)
    )
    part = bar + tongue

    assert len(part.solids()) == 1, f"expected 1 solid, got {len(part.solids())}"
    valid = part.is_valid
    assert bool(valid() if callable(valid) else valid), "OCCT reports an invalid solid"
    bb = part.bounding_box()
    for axis, size, limit in zip("XYZ", (bb.size.X, bb.size.Y, bb.size.Z), BUILD_VOLUME_MM):
        assert size <= limit, f"{axis} extent {size:.1f} mm exceeds the {limit:.0f} mm build volume"
    return part
```

- [ ] **Step 2: Build and verify**

Call `cad_run` on `cases/knee-brace/cad/upright.py`.

Expected: `error` null, `watertight` true, one solid, bbox about `[20, 145, 11]`.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/upright.py
git commit -m "feat(3d-coder): printed upright sized from PETG stiffness"
```

---

### Task 8: Cuff interface rework

**Files:**
- Modify: `cases/knee-brace/cad/cuff.py`

This undoes verified work, so it goes last. The cuff's boss currently carries a
rectangular slot and two M4 holes — a metal-fastener interface that an
all-printed brace cannot use.

- [ ] **Step 1: Remove the fastener parameters**

In `cuff.py` `PARAMS`, delete the `fastener_pitch` and `fastener_diameter`
entries entirely, and replace the `upright_width` / `upright_thickness` comments
so they no longer refer to a bought bar:

```python
    # Printed upright, sized from PETG stiffness - see cad/upright.py
    "upright_width": {"default": 20.0, "min": 12, "max": 34, "step": 1, "unit": "mm"},
    "upright_thickness": {"default": 11.0, "min": 6, "max": 18, "step": 0.5, "unit": "mm"},
    "tongue_taper": {"default": 3.0, "min": 1, "max": 8, "step": 0.5, "unit": "mm"},
```

- [ ] **Step 2: Replace the slot and holes with a dovetail socket**

Delete `_fastener_holes` entirely. Replace `_upright_slot` with:

```python
def _dovetail_socket(rungs, p):
    """Socket the upright's tapered tongue slides into.

    Wider at the mouth than at the blind end, so driving a wedge behind the
    tongue locks it in compression. Rivets were the alternative and are
    rejected: they load a small printed shank in shear, which is the failure
    mode the whole pivot design exists to avoid, and they cannot be undone for
    inspection. A wedge can be tapped out and re-driven when the joint loosens,
    which it will, because PETG creeps.
    """
    m = _boss_metrics(rungs, p)
    wide = p["upright_width"]
    narrow = wide - 2.0 * p["tongue_taper"]
    x = m["x_outer"] + BOSS_STRADDLE_MM + p["upright_thickness"] / 2.0
    lo = Pos(x, 0.0, m["z"] - m["length"] / 2.0 - 2.0) * Box(
        p["upright_thickness"], wide, 0.01
    )
    hi = Pos(x, 0.0, m["z"] + m["length"] / 2.0 + 2.0) * Box(
        p["upright_thickness"], narrow, 0.01
    )
    return loft([lo, hi], ruled=True)
```

Note `ruled=True`: a smooth loft between two sections undershoots, and this
socket must be a straight taper or the tongue will not seat.

- [ ] **Step 3: Update `build` and the boss metrics**

In `_boss_metrics`, change the width line so the boss is sized from the tongue
rather than a bar plus fastener margins:

```python
        "width": p["upright_width"] + 2.0 * BOSS_MARGIN_MM,
```

(unchanged — it already keys off `upright_width`), and in `build` replace the
three interface lines with:

```python
    part = part + _boss(rungs, p)
    part = part - _dovetail_socket(rungs, p)
```

- [ ] **Step 4: Build and verify the wall is still sound**

Call `cad_run` on `cases/knee-brace/cad/cuff.py`, then:

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe -u scratch/cuff_verify.py
```

Expected: watertight, `MIN WALL ... PASS` against 1.2 mm, angular coverage 220°,
bore intact at the boss. The through-hole count will change from 10 — the two
fastener holes are gone, so expect **8** (4 strap slots plus the socket).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff.py
git commit -m "feat(3d-coder): cuff dovetail socket replaces the metal-fastener boss"
```

---

### Task 9: Taper wedge and full-assembly render

**Files:**
- Create: `cases/knee-brace/cad/wedge.py`

- [ ] **Step 1: Write the script**

Create `cases/knee-brace/cad/wedge.py`:

```python
"""Printed taper WEDGE locking the upright tongue into the cuff socket.

Driven in from the proximal end behind the tongue. Loads the dovetail in
compression rather than loading a shank in shear, and can be tapped out and
re-driven when the joint loosens - which it will, because PETG creeps.
"""
from build123d import Align, Box, Pos, loft

PARAMS = {
    "wedge_length": {"default": 30.0, "min": 15, "max": 60, "step": 1, "unit": "mm"},
    "wedge_width": {"default": 18.0, "min": 8, "max": 32, "step": 1, "unit": "mm"},
    "wedge_thick_end": {"default": 5.0, "min": 2, "max": 12, "step": 0.5, "unit": "mm"},
    "wedge_thin_end": {"default": 2.0, "min": 1.2, "max": 8, "step": 0.5, "unit": "mm"},
}

BUILD_VOLUME_MM = (256.0, 256.0, 260.0)
MIN_WALL_MM = 1.2


def build(p):
    assert p["wedge_thin_end"] >= MIN_WALL_MM, (
        f"thin end {p['wedge_thin_end']:.2f} mm is under the {MIN_WALL_MM} mm minimum"
    )
    assert p["wedge_thin_end"] < p["wedge_thick_end"], (
        f"thin end {p['wedge_thin_end']:.1f} mm is not thinner than the thick end "
        f"{p['wedge_thick_end']:.1f} mm - that is a block, not a wedge"
    )

    thin = Box(p["wedge_width"], 0.01, p["wedge_thin_end"],
               align=(Align.CENTER, Align.MIN, Align.MIN))
    thick = Pos(0, p["wedge_length"], 0) * Box(
        p["wedge_width"], 0.01, p["wedge_thick_end"],
        align=(Align.CENTER, Align.MIN, Align.MIN)
    )
    part = loft([thin, thick], ruled=True)

    assert len(part.solids()) == 1, f"expected 1 solid, got {len(part.solids())}"
    valid = part.is_valid
    assert bool(valid() if callable(valid) else valid), "OCCT reports an invalid solid"
    bb = part.bounding_box()
    for axis, size, limit in zip("XYZ", (bb.size.X, bb.size.Y, bb.size.Z), BUILD_VOLUME_MM):
        assert size <= limit, f"{axis} extent {size:.1f} mm exceeds the {limit:.0f} mm build volume"
    return part
```

- [ ] **Step 2: Build and render the full set**

Call `cad_run` on `cases/knee-brace/cad/wedge.py`, then render every part:

```bash
cd /c/Users/azamk/Documents/3D-Coder
M="C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes"
./mesh-mcp/.venv/Scripts/python.exe scratch/nose_sheet.py \
  "thigh plate=$M\hinge_thigh.stl" \
  "calf plate=$M\hinge_calf.stl" \
  "upright=$M\upright.stl" \
  "cuff=$M\cuff.stl"
```

Read `scratch/nose_sheet.png` and confirm every part looks like what it is meant
to be: boss and lugs on the thigh plate, bore with relief cutouts and a follower
post on the calf plate, tapered tongue on the upright, dovetail socket on the
cuff boss.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/wedge.py
git commit -m "feat(3d-coder): taper wedge locking the upright into the cuff socket"
```

---

## Definition of done

- All nine tasks committed.
- `pytest test_hinge_math.py` green (8 tests).
- `cad_run` returns `error: null` and `watertight: true` for all six parts:
  `hinge_thigh`, `hinge_calf`, `stop_peg`, `upright`, `wedge`, `cuff`.
- `hinge_verify.py` reports a running fit between 0.15 and 0.9 mm, measured off
  the exported pair rather than assumed from parameters.
- Cuff still passes its own wall check at 1.2 mm after the rework.
- Every part inside 256 × 256 × 260 mm.
- Renders inspected by eye.

## Not done, and out of scope

Soft goods, fit validation, clinical assessment, and any load testing. **The
spec's safety position stands: this is a prototype.** PETG creeps, is
notch-sensitive at the slot ends and keyhole corners, and fatigues faster than
metal under the cyclic load a knee hinge sees by definition. Inspect the boss,
bore and pegs before each use.

The value most likely to be wrong is `pivot_clearance` at 0.35 mm — settle it
with a test print of the two plates before printing anything else.
